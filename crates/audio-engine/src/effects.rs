use crate::model::{AudioError, Settings};
use biquad::{Biquad, Coefficients, DirectForm1, ToHertz, Type};
use dsp_core::dynamics::{Compressor, CompressorParams};

pub struct Effects {
    filters: [Vec<DirectForm1<f32>>; 2],
    compressor: Option<Compressor>,
    preamp: f32,
}

impl Effects {
    pub fn new(rate: u32, settings: &Settings, gain_db: f32) -> Result<Self, AudioError> {
        let mut filters = [Vec::new(), Vec::new()];
        if settings.equalizer.enabled {
            for band in &settings.equalizer.bands {
                if band.freq >= rate as f32 / 2.0 {
                    continue;
                }
                let coefficients = Coefficients::<f32>::from_params(
                    Type::PeakingEQ(band.gain),
                    (rate as f32).hz(),
                    band.freq.hz(),
                    1.0,
                )
                .map_err(|e| AudioError(format!("Invalid equalizer coefficients: {e:?}")))?;
                for channel in &mut filters {
                    channel.push(DirectForm1::new(coefficients));
                }
            }
        }
        let compressor = if settings.compressor.enabled {
            Some(
                Compressor::new(CompressorParams {
                    sample_rate: f64::from(rate),
                    threshold_db: f64::from(settings.compressor.threshold),
                    ratio: f64::from(settings.compressor.ratio),
                    attack_ms: f64::from(settings.compressor.attack),
                    release_ms: f64::from(settings.compressor.release),
                    makeup_db: f64::from(settings.compressor.makeup),
                    knee_db: f64::from(settings.compressor.knee),
                })
                .map_err(|error| AudioError(error.to_string()))?,
            )
        } else {
            None
        };
        let preamp = if settings.equalizer.enabled {
            settings.equalizer.preamp
        } else {
            0.0
        };
        Ok(Self {
            filters,
            compressor,
            preamp: 10.0_f32.powf((preamp + gain_db) / 20.0),
        })
    }

    pub fn process(&mut self, frames: &mut [[f32; 2]]) {
        for frame in frames.iter_mut() {
            for (index, sample) in frame.iter_mut().enumerate() {
                *sample *= self.preamp;
                for filter in &mut self.filters[index] {
                    *sample = filter.run(*sample);
                }
            }
        }
        if let Some(compressor) = &mut self.compressor {
            for frame in frames {
                let peak = f64::from(frame[0].abs().max(frame[1].abs()));
                let compressed = compressor.process(peak);
                let gain = if peak > 0.0 {
                    (compressed / peak) as f32
                } else {
                    1.0
                };
                frame[0] *= gain;
                frame[1] *= gain;
            }
        }
    }
}
