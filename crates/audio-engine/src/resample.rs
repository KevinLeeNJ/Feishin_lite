use crate::model::AudioError;
use rubato::{
    Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};

const BLOCK: usize = 1024;

pub struct Converter {
    resampler: Option<SincFixedIn<f32>>,
    pending: Vec<[f32; 2]>,
    trim: usize,
    produced: usize,
    input: usize,
    ratio: f64,
}

impl Converter {
    pub fn new(input_rate: u32, output_rate: u32, speed: f64) -> Result<Self, AudioError> {
        let ratio = f64::from(output_rate) / f64::from(input_rate) / speed;
        let resampler = if (ratio - 1.0).abs() < f64::EPSILON {
            None
        } else {
            let parameters = SincInterpolationParameters {
                sinc_len: 128,
                f_cutoff: 0.95,
                oversampling_factor: 128,
                interpolation: SincInterpolationType::Linear,
                window: WindowFunction::BlackmanHarris2,
            };
            Some(
                SincFixedIn::new(ratio, 1.0, parameters, BLOCK, 2)
                    .map_err(|e| AudioError(e.to_string()))?,
            )
        };
        let trim = resampler.as_ref().map_or(0, Resampler::output_delay);
        Ok(Self {
            resampler,
            pending: Vec::new(),
            trim,
            produced: 0,
            input: 0,
            ratio,
        })
    }

    pub fn process(
        &mut self,
        frames: &[[f32; 2]],
        finish: bool,
    ) -> Result<Vec<[f32; 2]>, AudioError> {
        self.input += frames.len();
        if self.resampler.is_none() {
            return Ok(frames.to_vec());
        }
        self.pending.extend_from_slice(frames);
        let mut output = Vec::new();
        while self.pending.len() >= BLOCK
            || (finish
                && (!self.pending.is_empty()
                    || self.produced < (self.input as f64 * self.ratio).round() as usize))
        {
            let take = self.pending.len().min(BLOCK);
            let mut channels = vec![vec![0.0; BLOCK]; 2];
            for (index, frame) in self.pending.drain(..take).enumerate() {
                channels[0][index] = frame[0];
                channels[1][index] = frame[1];
            }
            let result = self
                .resampler
                .as_mut()
                .expect("resampler")
                .process(&channels, None)
                .map_err(|e| AudioError(e.to_string()))?;
            for index in 0..result[0].len() {
                if self.trim > 0 {
                    self.trim -= 1;
                    continue;
                }
                if finish && self.produced >= (self.input as f64 * self.ratio).round() as usize {
                    break;
                }
                output.push([result[0][index], result[1][index]]);
                self.produced += 1;
            }
        }
        Ok(output)
    }
}
