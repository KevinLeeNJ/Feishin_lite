mod output;
mod snapshot;
#[cfg(test)]
mod tests;

use crate::{
    model::{AudioError, Settings, Track},
    output::{Clock, Frame, Output},
    prefetch::{self, NextMessage},
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
    next_source_rate: Option<u32>,
    output_request: Option<u32>,
    runtime: Arc<tokio::runtime::Runtime>,
    output: Option<Output>,
    producer: Option<Arc<Mutex<HeapProd<Frame>>>>,
    settings: Option<Arc<Mutex<Settings>>>,
    track: Option<Track>,
    cancel: CancellationToken,
    prefetch_cancel: CancellationToken,
    prefetch_sequence: u64,
    updates: Option<Receiver<Update>>,
    seeks: Option<Sender<SeekRequest>>,
    nexts: Option<Sender<NextMessage>>,
    pending_commit: Option<PendingCommit>,
    generation: u64,
    complete: bool,
    error: Option<String>,
}

struct PendingCommit {
    track: Track,
    consumed_at: u64,
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
            next_source_rate: None,
            output_request: None,
            runtime: Arc::new(runtime),
            output: None,
            producer: None,
            settings: None,
            track: None,
            cancel: CancellationToken::new(),
            prefetch_cancel: CancellationToken::new(),
            prefetch_sequence: 0,
            updates: None,
            seeks: None,
            nexts: None,
            pending_commit: None,
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
        self.prefetch_cancel.cancel();
        self.source_rate = None;
        self.next_source_rate = None;
        self.apply_settings(settings.clone())?;
        self.cancel = CancellationToken::new();
        self.prefetch_cancel = CancellationToken::new();
        self.generation += 1;
        self.complete = false;
        self.error = None;
        self.pending_commit = None;
        self.clock.paused.store(paused, Ordering::Release);
        self.clock.begin(self.generation, start);
        let (sender, receiver) = mpsc::channel();
        let (seek_sender, seeks) = mpsc::channel();
        let (next_sender, nexts) = mpsc::channel();
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
            nexts,
            runtime: self.runtime.clone(),
        };
        std::thread::Builder::new()
            .name("audio-decode".into())
            .spawn(move || job.run())
            .map_err(|e| AudioError(e.to_string()))?;
        self.track = Some(track);
        self.updates = Some(receiver);
        self.seeks = Some(seek_sender);
        self.nexts = Some(next_sender);
        Ok(())
    }

    pub fn prepare_next(&mut self, track: Option<Track>) -> Result<(), AudioError> {
        if let Some(track) = &track {
            validate_track(track, 0.0)?;
        }
        let nexts = self
            .nexts
            .as_ref()
            .ok_or_else(|| AudioError("Audio worker is unavailable".into()))?;
        self.prefetch_cancel.cancel();
        self.prefetch_cancel = CancellationToken::new();
        self.prefetch_sequence += 1;
        self.next_source_rate = None;
        let sequence = self.prefetch_sequence;
        nexts
            .send(NextMessage::Cancel { sequence })
            .map_err(|_| AudioError("Audio worker is unavailable".into()))?;
        if let Some(track) = track {
            prefetch::spawn(
                &self.runtime,
                track,
                self.prefetch_cancel.clone(),
                nexts.clone(),
                sequence,
            );
        }
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
        if let Some(pending) = self.pending_commit.take() {
            self.track = Some(pending.track);
        }
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
        self.prefetch_cancel.cancel();
        self.pause(true);
        self.generation += 1;
        self.track = None;
        self.pending_commit = None;
        self.updates = None;
        self.seeks = None;
        self.nexts = None;
        self.output = None;
        self.producer = None;
        self.complete = false;
        self.error = None;
        self.source_rate = None;
        self.next_source_rate = None;
        self.clock
            .generation
            .store(self.generation, Ordering::Release);
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
                Update::NextSourceRate(sequence, rate) if sequence == self.prefetch_sequence => {
                    self.next_source_rate = Some(rate);
                }
                Update::Complete(generation) if generation == self.generation => {
                    self.complete = true
                }
                Update::Committed(generation, track, consumed_at)
                    if generation == self.generation =>
                {
                    self.pending_commit = Some(PendingCommit { track, consumed_at });
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
        self.prefetch_cancel.cancel();
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
