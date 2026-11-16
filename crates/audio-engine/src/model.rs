use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Track {
    pub instance_id: String,
    pub url: String,
    pub queue_revision: u64,
    pub duration: f64,
    pub gain_db: f32,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub volume: f32,
    pub muted: bool,
    pub speed: f64,
    pub preserve_pitch: bool,
    #[serde(default)]
    pub sample_rate: Option<u32>,
    #[serde(default)]
    pub exclusive: bool,
    pub device_id: Option<String>,
    pub fade_on_pause: bool,
    pub equalizer: Equalizer,
    pub compressor: Compressor,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Equalizer {
    pub enabled: bool,
    pub preamp: f32,
    pub bands: Vec<Band>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Band {
    pub freq: f32,
    pub gain: f32,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Compressor {
    pub enabled: bool,
    pub threshold: f32,
    pub ratio: f32,
    pub attack: f32,
    pub release: f32,
    pub makeup: f32,
    pub knee: f32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub instance_id: Option<String>,
    pub queue_revision: u64,
    pub position: f64,
    pub duration: f64,
    pub paused: bool,
    pub buffering: bool,
    pub ended: bool,
    pub error: Option<String>,
    pub underruns: u64,
    pub sample_rate: u32,
    pub output_latency_ms: f64,
}

#[derive(Debug)]
pub struct AudioError(pub String);

impl std::fmt::Display for AudioError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for AudioError {}

impl From<cpal::Error> for AudioError {
    fn from(error: cpal::Error) -> Self {
        Self(error.to_string())
    }
}

impl Settings {
    pub fn validate(&self) -> Result<(), AudioError> {
        let valid = self.volume.is_finite()
            && self
                .sample_rate
                .is_none_or(|rate| (8000..=384000).contains(&rate))
            && (0.0..=100.0).contains(&self.volume)
            && self.speed.is_finite()
            && (0.5..=2.0).contains(&self.speed)
            && self.equalizer.bands.len() <= 32
            && self.equalizer.preamp.is_finite()
            && (-24.0..=24.0).contains(&self.equalizer.preamp)
            && self.equalizer.bands.iter().all(|band| {
                band.freq.is_finite()
                    && (10.0..=24000.0).contains(&band.freq)
                    && band.gain.is_finite()
                    && (-24.0..=24.0).contains(&band.gain)
            })
            && self.compressor.threshold.is_finite()
            && (-100.0..=0.0).contains(&self.compressor.threshold)
            && self.compressor.ratio.is_finite()
            && (1.0..=20.0).contains(&self.compressor.ratio)
            && self.compressor.attack.is_finite()
            && (0.0..=1000.0).contains(&self.compressor.attack)
            && self.compressor.release.is_finite()
            && (0.0..=5000.0).contains(&self.compressor.release)
            && self.compressor.makeup.is_finite()
            && (0.0..=40.0).contains(&self.compressor.makeup)
            && self.compressor.knee.is_finite()
            && (0.0..=40.0).contains(&self.compressor.knee);
        if valid {
            Ok(())
        } else {
            Err(AudioError("Invalid audio settings".into()))
        }
    }
}
