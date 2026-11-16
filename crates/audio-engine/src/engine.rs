mod output;

use crate::{
    model::{AudioError, Settings, Snapshot, Track},
    output::{Clock, Frame, Output},
    worker::{Job, SeekRequest, Update},
};
use ringbuf::HeapProd;
use std::sync::{
    atomic::Ordering,
    mpsc::{self, Receiver, Sender},
    Arc, Mutex,
};
use tokio_util::sync::CancellationToken;

pub struct Engine {
    clock: Arc<Clock>,
    source_rate: Option<u32>,
    output_request: Option<u32>,
    runtime: Arc<tokio::runtime::Runtime>,
    output: Option<Output>,
    producer: Option<Arc<Mutex<HeapProd<Frame>>>>,
    settings: Option<Arc<Mutex<Settings>>>,
    track: Option<Track>,
    cancel: CancellationToken,
    updates: Option<Receiver<Update>>,
    seeks: Option<Sender<SeekRequest>>,
    generation: u64,
    complete: bool,
    error: Option<String>,
}

impl Engine {
    pub fn new() -> Result<Self, AudioError> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|e| AudioError(e.to_string()))?;
        let clock = Arc::new(Clock::default());
        clock.paused.store(true, Ordering::Release);
        Ok(Self {
            clock,
            source_rate: None,
            output_request: None,
            runtime: Arc::new(runtime),
            output: None,
            producer: None,
            settings: None,
            track: None,
            cancel: CancellationToken::new(),
            updates: None,
            seeks: None,
            generation: 0,
            complete: false,
            error: None,
        })
    }

    pub fn load(
        &mut self,
        track: Track,
        start: f64,
        paused: bool,
        settings: Settings,
    ) -> Result<(), AudioError> {
        settings.validate()?;
        validate_track(&track, start)?;
        self.cancel.cancel();
        self.source_rate = None;
        self.apply_settings(settings.clone())?;
        self.cancel = CancellationToken::new();
        self.generation += 1;
        self.complete = false;
        self.error = None;
        self.clock.paused.store(paused, Ordering::Release);
        self.clock.begin(self.generation, start);
        let (sender, receiver) = mpsc::channel();
        let (seek_sender, seeks) = mpsc::channel();
        let job = Job {
            track: track.clone(),
            generation: self.generation,
            start,
            target: None,
            settings: self.settings.as_ref().expect("settings").clone(),
            clock: self.clock.clone(),
            cancel: self.cancel.clone(),
            updates: sender,
            seeks,
            runtime: self.runtime.clone(),
        };
        std::thread::Builder::new()
            .name("audio-decode".into())
            .spawn(move || job.run())
            .map_err(|e| AudioError(e.to_string()))?;
        self.track = Some(track);
        self.updates = Some(receiver);
        self.seeks = Some(seek_sender);
        Ok(())
    }

    pub fn configure(&mut self, settings: Settings) -> Result<(), AudioError> {
        let changed_device = self.settings.is_some() && {
            let old = self.current_settings()?;
            old.device_id != settings.device_id
                || old.sample_rate != settings.sample_rate
                || old.exclusive != settings.exclusive
        };
        let snapshot = self.snapshot();
        if changed_device {
            if let Some(track) = self.track.clone() {
                return self.load(track, snapshot.position, snapshot.paused, settings);
            }
        }
        self.apply_settings(settings)
    }

    pub fn seek(&mut self, position: f64) -> Result<(), AudioError> {
        let track = self
            .track
            .as_ref()
            .ok_or_else(|| AudioError("No loaded track".into()))?;
        validate_track(track, position)?;
        let seeks = self
            .seeks
            .as_ref()
            .ok_or_else(|| AudioError("Audio worker is unavailable".into()))?;
        self.generation += 1;
        self.complete = false;
        self.error = None;
        self.clock.begin(self.generation, position);
        seeks
            .send(SeekRequest {
                generation: self.generation,
                position,
            })
            .map_err(|_| AudioError("Audio worker is unavailable".into()))
    }

    pub fn pause(&self, paused: bool) {
        self.clock.paused.store(paused, Ordering::Release);
    }

    pub fn stop(&mut self) {
        self.cancel.cancel();
        self.pause(true);
        self.generation += 1;
        self.track = None;
        self.updates = None;
        self.seeks = None;
        self.output = None;
        self.producer = None;
        self.complete = false;
        self.error = None;
        self.source_rate = None;
        self.clock
            .generation
            .store(self.generation, Ordering::Release);
    }

    pub fn snapshot(&mut self) -> Snapshot {
        self.drain_updates();
        let position = match self.audible_position() {
            Ok(position) => position,
            Err(error) => {
                self.error = Some(error.0);
                self.pause(true);
                0.0
            }
        };
        let paused = self.clock.paused.load(Ordering::Acquire);
        let duration = self.track.as_ref().map_or(0.0, |track| track.duration);
        let empty = self.clock.produced.load(Ordering::Acquire)
            <= self.clock.consumed.load(Ordering::Acquire);
        let ended = self.complete && empty;
        Snapshot {
            instance_id: self.track.as_ref().map(|t| t.instance_id.clone()),
            queue_revision: self.track.as_ref().map_or(0, |t| t.queue_revision),
            position,
            duration,
            paused,
            buffering: self.track.is_some()
                && !self.complete
                && (!self.clock.started.load(Ordering::Acquire)
                    || self.clock.starved.load(Ordering::Acquire)),
            ended,
            error: self.error.clone(),
            underruns: self
                .output
                .as_ref()
                .map_or(0, |o| o.clock.underruns.load(Ordering::Relaxed)),
            sample_rate: self.output.as_ref().map_or(0, |o| o.rate),
            output_latency_ms: self.output.as_ref().map_or(0.0, |o| {
                f64::from_bits(o.clock.latency.load(Ordering::Relaxed)) * 1000.0
            }),
        }
    }

    fn audible_position(&mut self) -> Result<f64, AudioError> {
        if self.clock.failed.load(Ordering::Acquire) {
            return Err(AudioError("Output device disconnected or failed".into()));
        }
        let position = f64::from_bits(self.clock.position.load(Ordering::Acquire));
        if self.clock.consumed.load(Ordering::Acquire) == 0 {
            return Ok(position);
        }
        let speed = self.current_settings()?.speed;
        Ok(
            (position - f64::from_bits(self.clock.latency.load(Ordering::Relaxed)) * speed)
                .max(0.0),
        )
    }

    fn current_settings(&self) -> Result<Settings, AudioError> {
        self.settings
            .as_ref()
            .ok_or_else(|| AudioError("Audio settings are unavailable".into()))?
            .lock()
            .map(|settings| settings.clone())
            .map_err(|_| AudioError("Audio settings poisoned".into()))
    }

    fn drain_updates(&mut self) {
        let Some(updates) = self.updates.take() else {
            return;
        };
        while let Ok(update) = updates.try_recv() {
            match update {
                Update::SourceRate(rate, response) => self.prepare_output(rate, response),
                Update::Duration(generation, duration)
                    if generation == self.generation && duration > 0.0 =>
                {
                    if let Some(track) = &mut self.track {
                        track.duration = duration;
                    }
                }
                Update::Complete(generation) if generation == self.generation => {
                    self.complete = true
                }
                Update::Error(generation, message) if generation == self.generation => {
                    self.error = Some(message);
                    self.pause(true);
                }
                _ => {}
            }
        }
        self.updates = Some(updates);
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}

fn validate_track(track: &Track, start: f64) -> Result<(), AudioError> {
    if track.instance_id.is_empty()
        || track.instance_id.len() > 128
        || track.url.len() > 16384
        || !start.is_finite()
        || start < 0.0
        || !track.duration.is_finite()
        || track.duration < 0.0
        || !track.gain_db.is_finite()
        || !(-60.0..=30.0).contains(&track.gain_db)
    {
        return Err(AudioError("Invalid audio track".into()));
    }
    Ok(())
}
