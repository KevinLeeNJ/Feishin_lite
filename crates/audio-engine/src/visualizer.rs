use crate::model::{AudioError, VisualizerSamples};
use base64::{engine::general_purpose::STANDARD, Engine};
use cpal::Sample;
use std::{
    collections::VecDeque,
    sync::Mutex,
    time::{Duration, Instant},
};

const LEASE: Duration = Duration::from_millis(250);
const MAX_RATE: usize = 384_000;
const STEREO: usize = 2;

#[derive(Default)]
pub(crate) struct VisualizerTap(Mutex<TapState>);

#[derive(Default)]
struct TapState {
    last_read: Option<Instant>,
    generation: u64,
    rate: u32,
    pcm: VecDeque<i16>,
}

impl VisualizerTap {
    // The output thread never waits for IPC or allocates memory here.
    pub fn record(&self, generation: u64, rate: u32, samples: &[f32]) {
        let Ok(mut state) = self.0.try_lock() else {
            return;
        };
        if state.last_read.is_none_or(|read| read.elapsed() > LEASE) {
            return;
        }
        if state.generation != generation || state.rate != rate {
            state.pcm.clear();
            state.generation = generation;
            state.rate = rate;
        }
        let capacity = (rate as usize).min(MAX_RATE) * STEREO / 10;
        let recent = &samples[samples.len().saturating_sub(capacity)..];
        let excess = (state.pcm.len() + recent.len()).saturating_sub(capacity);
        state.pcm.drain(..excess);
        state
            .pcm
            .extend(recent.iter().copied().map(i16::from_sample));
    }

    pub fn read(
        &self,
        generation: u64,
        rate: u32,
    ) -> Result<Option<VisualizerSamples>, AudioError> {
        let mut state = self
            .0
            .lock()
            .map_err(|_| AudioError("Visualizer sample buffer poisoned".into()))?;
        if state.last_read.is_none_or(|read| read.elapsed() > LEASE) {
            state.pcm.clear();
        }
        if state.last_read.is_none() {
            state.pcm.reserve(MAX_RATE * STEREO / 10);
        }
        state.last_read = Some(Instant::now());
        if state.generation != generation || state.rate != rate || state.pcm.is_empty() {
            return Ok(None);
        }
        let bytes = state
            .pcm
            .drain(..)
            .flat_map(i16::to_le_bytes)
            .collect::<Vec<_>>();
        drop(state);
        Ok(Some(VisualizerSamples {
            generation,
            sample_rate: rate,
            pcm: STANDARD.encode(bytes),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn captures_bounded_stereo_pcm_on_demand_and_discards_stale_generations() {
        let tap = VisualizerTap::default();
        tap.record(1, 48_000, &[1.0, 1.0]);
        assert!(tap.read(1, 48_000).unwrap().is_none());

        let mut samples = vec![0.0; 9_600];
        samples.extend([-1.0, 0.5]);
        tap.record(1, 48_000, &samples);
        let packet = tap.read(1, 48_000).unwrap().unwrap();
        assert_eq!(packet.generation, 1);
        assert_eq!(packet.sample_rate, 48_000);
        let pcm = STANDARD.decode(packet.pcm).unwrap();
        assert_eq!(pcm.len(), 19_200);
        assert_eq!(pcm[pcm.len() - 4..], [0, 128, 0, 64]);
        assert!(tap.read(1, 48_000).unwrap().is_none());

        tap.record(1, 48_000, &[1.0, 1.0]);
        assert!(tap.read(2, 44_100).unwrap().is_none());
        tap.record(2, 44_100, &[0.0, 0.0]);
        let packet = tap.read(2, 44_100).unwrap().unwrap();
        assert_eq!(STANDARD.decode(packet.pcm).unwrap(), [0; 4]);
    }
}
