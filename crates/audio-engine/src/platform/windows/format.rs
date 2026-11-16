use crate::model::AudioError;
use wasapi::{AudioClient, SampleType, WaveFormat};

pub(super) fn select(
    client: &AudioClient,
    rate: Option<u32>,
    exclusive: bool,
) -> Result<WaveFormat, AudioError> {
    if !exclusive {
        let rate = match rate {
            Some(rate) => rate,
            None => client.get_mixformat()?.get_samplespersec(),
        };
        return Ok(WaveFormat::new(
            32,
            32,
            SampleType::Float,
            rate as usize,
            2,
            None,
        ));
    }
    let rate = rate.ok_or_else(|| {
        AudioError("Exclusive output requires the decoded source sample rate".into())
    })?;
    if let Some(format) = at_rate(client, rate) {
        return Ok(format);
    }
    let mut supported: Vec<_> = [
        48000, 44100, 96000, 88200, 192000, 176400, 32000, 22050, 11025, 8000, 16000, 352800,
        384000,
    ]
    .into_iter()
    .filter_map(|rate| at_rate(client, rate))
    .collect();
    supported.sort_by_key(|format| preference(rate, format.get_samplespersec()));
    let format = supported.into_iter().next().ok_or_else(|| {
        AudioError(format!(
            "No supported exclusive stereo format for {rate} Hz"
        ))
    })?;
    eprintln!(
        "WASAPI negotiated exclusive sample rate {rate} -> {} Hz",
        format.get_samplespersec()
    );
    Ok(format)
}

fn at_rate(client: &AudioClient, rate: u32) -> Option<WaveFormat> {
    for (bits, valid, kind) in [
        (32, 32, SampleType::Float),
        (32, 32, SampleType::Int),
        (32, 24, SampleType::Int),
        (24, 24, SampleType::Int),
        (16, 16, SampleType::Int),
    ] {
        let candidate = WaveFormat::new(bits, valid, kind, rate as usize, 2, None);
        if let Ok(format) = client.is_supported_exclusive_with_quirks(&candidate) {
            return Some(format);
        }
    }
    None
}

// Match mpv's rate negotiation: exact, lowest integer multiple, highest supported.
fn preference(requested: u32, supported: u32) -> (u8, u32) {
    if supported == requested {
        (0, 0)
    } else if supported.is_multiple_of(requested) {
        (1, supported)
    } else {
        (2, u32::MAX - supported)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exclusive_negotiation_matches_original_rate_preferences() {
        for (requested, expected) in [
            (44100, 44100),
            (22050, 44100),
            (24000, 48000),
            (12345, 192000),
        ] {
            let mut rates = [192000, 96000, 48000, 44100, 88200];
            rates.sort_by_key(|rate| preference(requested, *rate));
            assert_eq!(rates[0], expected);
        }
    }
}
