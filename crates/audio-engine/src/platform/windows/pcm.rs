use crate::{
    gain::GainRamp,
    model::AudioError,
    output::{render, Clock, Frame},
};
use cpal::Sample;
use ringbuf::HeapCons;
use std::sync::atomic::Ordering;
use wasapi::{AudioClient, AudioRenderClient, SampleType, WaveFormat};

pub(super) struct Buffer {
    samples: Vec<f32>,
    bytes: Vec<u8>,
    format: WaveFormat,
    ramp: GainRamp,
    exclusive: bool,
}

impl Buffer {
    pub fn new(format: &WaveFormat, frames: usize, exclusive: bool) -> Self {
        let samples = frames * usize::from(format.get_nchannels());
        Self {
            samples: vec![0.0; samples],
            bytes: vec![0; frames * format.get_blockalign() as usize],
            format: format.clone(),
            ramp: GainRamp::default(),
            exclusive,
        }
    }

    pub fn write(
        &mut self,
        client: &AudioClient,
        output: &AudioRenderClient,
        consumer: &mut HeapCons<Frame>,
        clock: &Clock,
    ) -> Result<(), AudioError> {
        let frames = client.get_available_space_in_frames()? as usize;
        if frames == 0 {
            return Ok(());
        }
        let channels = usize::from(self.format.get_nchannels());
        let rate = self.format.get_samplespersec();
        let latency = client.get_stream_latency()? as f64 / 10_000_000.0
            + f64::from(client.get_current_padding()?) / f64::from(rate);
        clock.latency.store(latency.to_bits(), Ordering::Release);
        let samples = &mut self.samples[..frames * channels];
        let generation = clock.generation.load(Ordering::Acquire);
        render(samples, channels, rate, consumer, clock, &mut self.ramp);
        let bytes = &mut self.bytes[..frames * self.format.get_blockalign() as usize];
        encode(samples, bytes, &self.format)?;
        output.write_to_device(bytes, None)?;
        if self.exclusive && generation == clock.generation.load(Ordering::Acquire) {
            clock.visualizer.record(generation, rate, samples);
        }
        Ok(())
    }
}

fn encode(samples: &[f32], bytes: &mut [u8], format: &WaveFormat) -> Result<(), AudioError> {
    let width = usize::from(format.get_bitspersample() / 8);
    let kind = format.get_subformat()?;
    for (sample, output) in samples.iter().zip(bytes.chunks_exact_mut(width)) {
        match (kind, width) {
            (SampleType::Float, 4) => output.copy_from_slice(&sample.to_le_bytes()),
            (SampleType::Int, 2) => {
                output.copy_from_slice(&i16::from_sample(*sample).to_le_bytes())
            }
            (SampleType::Int, 3) => {
                output.copy_from_slice(&i32::from_sample(*sample).to_le_bytes()[1..])
            }
            (SampleType::Int, 4) => {
                let shift = 32 - format.get_validbitspersample();
                let value = (i32::from_sample(*sample) >> shift) << shift;
                output.copy_from_slice(&value.to_le_bytes());
            }
            _ => return Err(AudioError("Unsupported WASAPI PCM representation".into())),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pcm_formats_preserve_signed_amplitude_and_container_alignment() {
        for (bits, valid, expected) in [
            (16, 16, vec![0, 128, 0, 64]),
            (24, 24, vec![0, 0, 128, 0, 0, 64]),
            (32, 24, vec![0, 0, 0, 128, 0, 0, 0, 64]),
            (32, 32, vec![0, 0, 0, 128, 0, 0, 0, 64]),
        ] {
            let format = WaveFormat::new(bits, valid, SampleType::Int, 48000, 2, None);
            let mut bytes = vec![0; expected.len()];
            encode(&[-1.0, 0.5], &mut bytes, &format).unwrap();
            assert_eq!(bytes, expected);
        }
        let format = WaveFormat::new(32, 32, SampleType::Float, 48000, 2, None);
        let mut bytes = [0; 8];
        encode(&[-1.0, 0.5], &mut bytes, &format).unwrap();
        assert_eq!(&bytes[..4], &(-1.0_f32).to_le_bytes());
        assert_eq!(&bytes[4..], &0.5_f32.to_le_bytes());
    }
}
