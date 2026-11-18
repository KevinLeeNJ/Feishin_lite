use super::Engine;
use crate::model::{AudioError, Snapshot};
use std::sync::atomic::Ordering;

impl Engine {
    pub fn snapshot(&mut self) -> Snapshot {
        self.drain_updates();
        if let Some(pending) = self.pending_commit.take() {
            if self.clock.consumed.load(Ordering::Acquire) > pending.consumed_at {
                self.track = Some(pending.track);
                self.next_source_rate = None;
            } else {
                self.pending_commit = Some(pending);
            }
        }
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
            transition_rate_mismatch: self.transition_rate_mismatch(),
            output_latency_ms: self.output.as_ref().map_or(0.0, |o| {
                f64::from_bits(o.clock.latency.load(Ordering::Relaxed)) * 1000.0
            }),
        }
    }

    fn transition_rate_mismatch(&self) -> bool {
        self.next_source_rate
            .zip(self.source_rate)
            .is_some_and(|(next, current)| {
                self.current_settings()
                    .is_ok_and(|settings| settings.transition_rate_mismatch(current, next))
            })
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
}
