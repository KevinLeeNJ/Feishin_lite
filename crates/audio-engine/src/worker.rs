use crate::{
    decoder::DecoderStream,
    media::NetworkMedia,
    model::{AudioError, Settings, Track},
    output::{push, Clock, Frame},
    processing::Pipeline,
};
use ringbuf::HeapProd;
use std::sync::{
    atomic::Ordering,
    mpsc::{Receiver, RecvTimeoutError, Sender},
    Arc, Mutex,
};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

pub enum Update {
    SourceRate(u32, Sender<Result<Target, AudioError>>),
    Duration(u64, f64),
    Complete(u64),
    Error(u64, String),
}

pub struct SeekRequest {
    pub generation: u64,
    pub position: f64,
}

pub struct Job {
    pub track: Track,
    pub generation: u64,
    pub start: f64,
    pub target: Option<Target>,
    pub settings: Arc<Mutex<Settings>>,
    pub clock: Arc<Clock>,
    pub cancel: CancellationToken,
    pub updates: Sender<Update>,
    pub seeks: Receiver<SeekRequest>,
    pub runtime: Arc<tokio::runtime::Runtime>,
}

pub struct Target {
    pub rate: u32,
    pub producer: Arc<Mutex<HeapProd<Frame>>>,
}

struct Playback {
    decoder: DecoderStream,
    pipeline: Pipeline,
    position: f64,
    finished: bool,
}

impl Job {
    pub fn run(mut self) {
        if let Err(error) = self.decode() {
            if !self.cancel.is_cancelled() {
                let generation = self.clock.generation.load(Ordering::Acquire);
                let _ = self.updates.send(Update::Error(generation, error.0));
            }
        }
    }

    fn decode(&mut self) -> Result<(), AudioError> {
        let mut playback = self.open()?;
        self.report_duration(playback.decoder.duration)?;
        while !self.cancel.is_cancelled() {
            if let Some(request) = self.next_seek(&playback)? {
                if request.generation != self.clock.generation.load(Ordering::Acquire) {
                    continue;
                }
                self.generation = request.generation;
                playback.decoder.seek(request.position)?;
                playback.pipeline = Pipeline::new(
                    playback.decoder.rate,
                    self.target().rate,
                    self.current_settings()?,
                    self.track.gain_db,
                )?;
                playback.position = request.position;
                playback.finished = false;
                self.report_duration(playback.decoder.duration)?;
            }
            if !playback.finished
                && self.generation == self.clock.generation.load(Ordering::Acquire)
            {
                self.decode_next(&mut playback)?;
            }
        }
        Ok(())
    }

    fn open(&mut self) -> Result<Playback, AudioError> {
        let media = self.runtime.block_on(async {
            tokio::select! {
                result = NetworkMedia::open(&self.track.url, self.cancel.clone()) => result,
                _ = self.cancel.cancelled() => Err(AudioError("Cancelled".into())),
            }
        })?;
        let decoder = DecoderStream::open(Box::new(media), self.start)?;
        self.prepare_output(decoder.rate)?;
        let pipeline = Pipeline::new(
            decoder.rate,
            self.target().rate,
            self.current_settings()?,
            self.track.gain_db,
        )?;
        Ok(Playback {
            decoder,
            pipeline,
            position: self.start,
            finished: false,
        })
    }

    fn prepare_output(&mut self, source_rate: u32) -> Result<(), AudioError> {
        let (sender, response) = std::sync::mpsc::channel();
        self.updates
            .send(Update::SourceRate(source_rate, sender))
            .map_err(|_| AudioError("Audio control closed".into()))?;
        while !self.cancel.is_cancelled() {
            match response.recv_timeout(Duration::from_millis(20)) {
                Ok(target) => {
                    self.target = Some(target?);
                    break;
                }
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(AudioError("Audio output preparation closed".into()))
                }
            }
        }
        if self.cancel.is_cancelled() {
            return Err(AudioError("Cancelled".into()));
        }
        Ok(())
    }

    fn next_seek(&self, playback: &Playback) -> Result<Option<SeekRequest>, AudioError> {
        let timeout = if playback.finished
            || self.generation != self.clock.generation.load(Ordering::Acquire)
        {
            Duration::from_millis(20)
        } else {
            Duration::ZERO
        };
        match self.seeks.recv_timeout(timeout) {
            Ok(mut request) => {
                for newer in self.seeks.try_iter() {
                    request = newer;
                }
                Ok(Some(request))
            }
            Err(RecvTimeoutError::Timeout) => Ok(None),
            Err(RecvTimeoutError::Disconnected) => Err(AudioError("Audio control closed".into())),
        }
    }

    fn decode_next(&self, playback: &mut Playback) -> Result<(), AudioError> {
        let input = playback.decoder.next()?;
        let finish = input.is_none();
        let settings = self.current_settings()?;
        let output =
            playback
                .pipeline
                .process(input.as_deref().unwrap_or(&[]), finish, &settings)?;
        if !self.write(&output, &mut playback.position, settings.speed)? {
            return Ok(());
        }
        if finish && self.generation == self.clock.generation.load(Ordering::Acquire) {
            playback.finished = true;
            self.clock.finished.store(true, Ordering::Release);
            self.updates
                .send(Update::Complete(self.generation))
                .map_err(|_| AudioError("Audio control closed".into()))?;
        }
        Ok(())
    }

    fn write(
        &self,
        frames: &[[f32; 2]],
        position: &mut f64,
        speed: f64,
    ) -> Result<bool, AudioError> {
        let target = self.target();
        let mut producer = target
            .producer
            .lock()
            .map_err(|_| AudioError("Audio buffer poisoned".into()))?;
        for samples in frames {
            *position += speed / f64::from(target.rate);
            let frame = Frame {
                samples: *samples,
                position: *position,
                generation: self.generation,
            };
            if !push(&mut producer, frame, &self.cancel, &self.clock) {
                return Ok(false);
            }
            if self.generation == self.clock.generation.load(Ordering::Acquire) {
                self.clock.produced.fetch_add(1, Ordering::Release);
                self.clock.started.store(true, Ordering::Release);
            }
        }
        Ok(true)
    }

    fn current_settings(&self) -> Result<Settings, AudioError> {
        self.settings
            .lock()
            .map(|settings| settings.clone())
            .map_err(|_| AudioError("Audio settings poisoned".into()))
    }

    fn target(&self) -> &Target {
        self.target.as_ref().expect("prepared audio output")
    }

    fn report_duration(&self, duration: f64) -> Result<(), AudioError> {
        self.updates
            .send(Update::Duration(self.generation, duration))
            .map_err(|_| AudioError("Audio control closed".into()))
    }
}
