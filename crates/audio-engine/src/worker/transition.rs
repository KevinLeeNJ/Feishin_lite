use super::{Job, Playback, Update};
use crate::{
    decoder::DecoderStream,
    model::{AudioError, CrossfadeCurve, Settings, Track, TransitionMode},
    prefetch::PreparedNext,
    processing::Pipeline,
};
use std::collections::VecDeque;
use std::sync::atomic::Ordering;

const REFILL: usize = 4096;
const MIX_BATCH: usize = 1024;

pub enum Step {
    Continue,
    Commit,
    Abort,
}

pub struct Overlap {
    pub track: Track,
    pub next: Playback,
    a_buf: VecDeque<[f32; 2]>,
    b_buf: VecDeque<[f32; 2]>,
    a_done: bool,
    b_done: bool,
    start: f64,
    duration: f64,
    curve: CrossfadeCurve,
}

impl Overlap {
    pub fn arm(
        job: &Job,
        current: &Playback,
        prepared: PreparedNext,
        duration: f64,
        curve: CrossfadeCurve,
    ) -> Result<Self, AudioError> {
        let pipeline = Pipeline::new(
            prepared.decoder.rate,
            job.target().rate,
            job.current_settings()?,
            prepared.track.gain_db,
            prepared.decoder.replay_gain.or(prepared.track.replay_gain),
        )?;
        Ok(Self {
            track: prepared.track,
            next: Playback {
                decoder: prepared.decoder,
                pipeline,
                position: 0.0,
                finished: false,
            },
            a_buf: VecDeque::new(),
            b_buf: VecDeque::new(),
            a_done: false,
            b_done: false,
            start: current.position,
            duration,
            curve,
        })
    }

    pub fn next_finished(&self) -> bool {
        self.b_done && self.b_buf.is_empty()
    }

    pub fn pump(&mut self, job: &Job, current: &mut Playback) -> Result<Step, AudioError> {
        let settings = job.current_settings()?;
        refill(
            &mut current.decoder,
            &mut current.pipeline,
            &mut self.a_buf,
            &mut self.a_done,
            &settings,
        )?;
        if self.a_done && self.a_buf.is_empty() {
            return Ok(Step::Commit);
        }
        if !self.b_done {
            if let Err(error) = refill(
                &mut self.next.decoder,
                &mut self.next.pipeline,
                &mut self.b_buf,
                &mut self.b_done,
                &settings,
            ) {
                eprintln!("Crossfade next track failed: {error}");
                return Ok(Step::Abort);
            }
        }
        let available = if self.b_done {
            self.a_buf.len()
        } else {
            self.a_buf.len().min(self.b_buf.len())
        };
        let count = available.min(MIX_BATCH);
        if count == 0 {
            return Ok(Step::Continue);
        }
        let speed = settings.speed;
        let step = speed / f64::from(job.target().rate);
        let mut position = current.position;
        let mut mixed = Vec::with_capacity(count);
        for _ in 0..count {
            let a = self.a_buf.pop_front().expect("buffered current frame");
            let b = self.b_buf.pop_front().unwrap_or([0.0; 2]);
            let progress = ((position - self.start) / self.duration).clamp(0.0, 1.0);
            let (out_gain, in_gain) = gains(self.curve, progress);
            mixed.push([
                a[0] * out_gain + b[0] * in_gain,
                a[1] * out_gain + b[1] * in_gain,
            ]);
            position += step;
        }
        if !job.write(&mixed, &mut current.position, speed)? {
            return Ok(Step::Continue);
        }
        self.next.position += step * count as f64;
        Ok(Step::Continue)
    }
}

fn refill(
    decoder: &mut DecoderStream,
    pipeline: &mut Pipeline,
    buffer: &mut VecDeque<[f32; 2]>,
    done: &mut bool,
    settings: &Settings,
) -> Result<(), AudioError> {
    while !*done && buffer.len() < REFILL {
        let input = decoder.next()?;
        let finish = input.is_none();
        buffer.extend(pipeline.process(input.as_deref().unwrap_or(&[]), finish, settings)?);
        *done = finish;
    }
    Ok(())
}

// Mirrors web-player.tsx getCrossfadeEasing verbatim: current gain is
// (1 - easeOut(progress)), next gain is easeIn(progress).
fn gains(curve: CrossfadeCurve, progress: f64) -> (f32, f32) {
    let (ease_in, ease_out) = match curve {
        CrossfadeCurve::EqualPower => (
            (std::f64::consts::FRAC_PI_2 * progress).sin(),
            1.0 - (std::f64::consts::FRAC_PI_2 * progress).cos(),
        ),
        CrossfadeCurve::Exponential => {
            let decay = (-5.0 * progress).exp();
            let end = (-5.0_f64).exp();
            (1.0 - decay, (decay - end) / (1.0 - end))
        }
        CrossfadeCurve::Linear => (progress, progress),
        CrossfadeCurve::SCurve => {
            let smooth = progress * progress * (3.0 - 2.0 * progress);
            (smooth, smooth)
        }
    };
    ((1.0 - ease_out) as f32, ease_in as f32)
}

impl Job {
    pub(super) fn try_arm(
        &mut self,
        playback: &Playback,
        pending: &mut Option<PreparedNext>,
        overlap: &mut Option<Overlap>,
    ) -> Result<(), AudioError> {
        let Some(prepared) = pending.as_ref() else {
            return Ok(());
        };
        let settings = self.current_settings()?;
        if settings.transition.mode != TransitionMode::Crossfade
            || settings.transition_rate_mismatch(playback.decoder.rate, prepared.decoder.rate)
            || settings.transition.crossfade_duration <= 0.0
            || self.duration_of(playback) - playback.position
                > settings.transition.crossfade_duration
        {
            return Ok(());
        }
        let prepared = pending.take().expect("checked pending next");
        match Overlap::arm(
            self,
            playback,
            prepared,
            settings.transition.crossfade_duration,
            settings.transition.crossfade_style,
        ) {
            Ok(active) => *overlap = Some(active),
            Err(error) => eprintln!("Crossfade start failed: {error}"),
        }
        Ok(())
    }

    pub(super) fn switch_gapless(
        &mut self,
        playback: &mut Playback,
        prepared: PreparedNext,
    ) -> Result<(), AudioError> {
        let settings = self.current_settings()?;
        let pipeline = match Pipeline::new(
            prepared.decoder.rate,
            self.target().rate,
            settings,
            prepared.track.gain_db,
            prepared.decoder.replay_gain.or(prepared.track.replay_gain),
        ) {
            Ok(pipeline) => pipeline,
            Err(error) => {
                eprintln!("Gapless switch failed: {error}");
                return self.finish(playback);
            }
        };
        let consumed_at = self.clock.produced.load(Ordering::Acquire);
        let track = self.committed_track(&prepared.track, prepared.decoder.duration);
        self.send_committed(track.clone(), consumed_at)?;
        self.track = track;
        *playback = Playback {
            decoder: prepared.decoder,
            pipeline,
            position: 0.0,
            finished: false,
        };
        Ok(())
    }

    pub(super) fn commit(
        &mut self,
        playback: &mut Playback,
        active: Overlap,
    ) -> Result<(), AudioError> {
        let consumed_at = self.clock.produced.load(Ordering::Acquire);
        let track = self.committed_track(&active.track, active.next.decoder.duration);
        self.send_committed(track.clone(), consumed_at)?;
        self.track = track;
        let finished = active.next_finished();
        *playback = active.next;
        if finished {
            self.finish(playback)
        } else {
            playback.finished = false;
            Ok(())
        }
    }

    pub(super) fn finish(&mut self, playback: &mut Playback) -> Result<(), AudioError> {
        playback.finished = true;
        self.clock.finished.store(true, Ordering::Release);
        self.updates
            .send(Update::Complete(self.generation))
            .map_err(|_| AudioError("Audio control closed".into()))
    }

    fn send_committed(&self, track: Track, consumed_at: u64) -> Result<(), AudioError> {
        self.updates
            .send(Update::Committed(self.generation, track, consumed_at))
            .map_err(|_| AudioError("Audio control closed".into()))
    }

    fn committed_track(&self, track: &Track, decoded_duration: f64) -> Track {
        let mut track = track.clone();
        if decoded_duration > 0.0 {
            track.duration = decoded_duration;
        }
        track
    }

    fn duration_of(&self, playback: &Playback) -> f64 {
        if playback.decoder.duration > 0.0 {
            playback.decoder.duration
        } else {
            self.track.duration
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelopes_match_web_boundary_values() {
        for curve in [
            CrossfadeCurve::EqualPower,
            CrossfadeCurve::Linear,
            CrossfadeCurve::SCurve,
        ] {
            let (out, incoming) = gains(curve, 0.0);
            assert!((out - 1.0).abs() < 1e-6 && incoming.abs() < 1e-6);
            let (out, incoming) = gains(curve, 1.0);
            assert!(out.abs() < 1e-6 && (incoming - 1.0).abs() < 1e-6);
        }
        let (out, incoming) = gains(CrossfadeCurve::EqualPower, 0.5);
        assert!((out * out + incoming * incoming - 1.0).abs() < 1e-6);
        let (out, incoming) = gains(CrossfadeCurve::Linear, 0.5);
        assert!((out - 0.5).abs() < 1e-6 && (incoming - 0.5).abs() < 1e-6);
        // Web's exponential curve starts both gains at 0 and ends at (1, 1 - e^-5).
        let (out, incoming) = gains(CrossfadeCurve::Exponential, 0.0);
        assert!(out.abs() < 1e-6 && incoming.abs() < 1e-6);
        let (out, incoming) = gains(CrossfadeCurve::Exponential, 1.0);
        assert!(
            (out - 1.0).abs() < 1e-6 && (incoming - (1.0 - (-5.0_f64).exp()) as f32).abs() < 1e-6
        );
    }
}
