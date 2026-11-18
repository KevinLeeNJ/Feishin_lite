use serde::Deserialize;
use symphonia::core::meta::{Metadata, StandardTagKey, Tag, Value};

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Tags {
    track_gain: Option<f32>,
    track_peak: Option<f32>,
    album_gain: Option<f32>,
    album_peak: Option<f32>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReplayGain {
    mode: Mode,
    clip: bool,
    preamp_db: f32,
    fallback_db: Option<f32>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
enum Mode {
    Album,
    #[default]
    No,
    Track,
}

impl ReplayGain {
    pub fn gain_db(self, tags: Tags) -> f32 {
        let (gain, peak) = match self.mode {
            Mode::No => return 0.0,
            Mode::Track => (
                tags.track_gain.or(tags.album_gain),
                tags.track_peak.or(tags.album_peak),
            ),
            Mode::Album => (
                tags.album_gain.or(tags.track_gain),
                tags.album_peak.or(tags.track_peak),
            ),
        };
        let Some(gain) = gain.or_else(|| self.fallback_db.filter(|gain| *gain != 0.0)) else {
            return 0.0;
        };
        let adjusted = gain + self.preamp_db;
        let limited = if self.clip {
            adjusted.min(-20.0 * peak.unwrap_or(1.0).log10())
        } else {
            adjusted
        };
        limited.clamp(-60.0, 30.0)
    }

    pub fn is_valid(self) -> bool {
        self.preamp_db.is_finite() && self.fallback_db.is_none_or(f32::is_finite)
    }
}

impl Tags {
    pub fn or(self, other: Self) -> Self {
        Self {
            track_gain: self
                .track_gain
                .or(other.track_gain)
                .filter(|x| x.is_finite()),
            track_peak: self.track_peak.or(other.track_peak).filter(valid_peak),
            album_gain: self
                .album_gain
                .or(other.album_gain)
                .filter(|x| x.is_finite()),
            album_peak: self.album_peak.or(other.album_peak).filter(valid_peak),
        }
    }

    pub fn from_metadata(metadata: Metadata<'_>) -> Self {
        let mut tags = Self::default();
        if let Some(revision) = metadata.current() {
            for tag in revision.tags() {
                tags.add(tag);
            }
        }
        tags
    }

    fn add(&mut self, tag: &Tag) {
        use StandardTagKey::*;
        let key = tag.std_key.or_else(|| {
            let key = tag
                .key
                .rsplit_once(':')
                .map_or(tag.key.as_str(), |(_, name)| name);
            match key.to_ascii_lowercase().as_str() {
                "replaygain_track_gain" => Some(ReplayGainTrackGain),
                "replaygain_track_peak" => Some(ReplayGainTrackPeak),
                "replaygain_album_gain" => Some(ReplayGainAlbumGain),
                "replaygain_album_peak" => Some(ReplayGainAlbumPeak),
                _ => None,
            }
        });
        let target = match key {
            Some(ReplayGainTrackGain) => &mut self.track_gain,
            Some(ReplayGainTrackPeak) => &mut self.track_peak,
            Some(ReplayGainAlbumGain) => &mut self.album_gain,
            Some(ReplayGainAlbumPeak) => &mut self.album_peak,
            _ => return,
        };
        let value = match &tag.value {
            Value::Float(value) => Some(*value as f32),
            Value::String(value) => value.split_whitespace().next().and_then(|n| n.parse().ok()),
            _ => None,
        };
        let is_peak = matches!(key, Some(ReplayGainTrackPeak | ReplayGainAlbumPeak));
        if let Some(value) = value.filter(|n| n.is_finite() && (!is_peak || valid_peak(n))) {
            *target = Some(value);
        }
    }
}

fn valid_peak(peak: &f32) -> bool {
    peak.is_finite() && *peak > 0.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_mode_preamp_clipping_and_missing_tag_fallback() {
        let mut tags = Tags::default();
        tags.add(&Tag::new(
            Some(StandardTagKey::ReplayGainAlbumGain),
            "REPLAYGAIN_ALBUM_GAIN",
            Value::String("-7.5 dB".into()),
        ));
        tags.add(&Tag::new(
            None,
            "TXXX:replaygain_track_peak",
            Value::Float(0.5),
        ));
        let settings = ReplayGain {
            mode: Mode::Track,
            clip: true,
            preamp_db: 16.0,
            fallback_db: Some(-4.0),
        };
        assert!((settings.gain_db(tags) - 6.0206).abs() < 0.001);
        let album = ReplayGain {
            mode: Mode::Album,
            clip: false,
            preamp_db: 2.0,
            ..settings
        };
        assert_eq!(album.gain_db(tags), -5.5);
        assert_eq!(album.gain_db(Tags::default()), -2.0);
        assert_eq!(ReplayGain::default().gain_db(tags), 0.0);
    }
}
