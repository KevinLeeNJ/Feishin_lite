use crate::model::AudioError;
use symphonia::core::{
    audio::SampleBuffer,
    codecs::{Decoder, DecoderOptions},
    errors::Error,
    formats::{FormatOptions, FormatReader, SeekMode, SeekTo},
    io::{MediaSource, MediaSourceStream},
    meta::MetadataOptions,
    probe::Hint,
    units::{Time, TimeBase},
};

pub struct DecoderStream {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn Decoder>,
    track_id: u32,
    pub rate: u32,
    pub duration: f64,
    discard_until: f64,
    time_base: TimeBase,
}

impl DecoderStream {
    pub fn open(source: Box<dyn MediaSource>, start: f64) -> Result<Self, AudioError> {
        let stream = MediaSourceStream::new(source, Default::default());
        let options = FormatOptions {
            enable_gapless: true,
            ..Default::default()
        };
        let mut format = symphonia::default::get_probe()
            .format(&Hint::new(), stream, &options, &MetadataOptions::default())
            .map_err(decode_error)?
            .format;
        let track = format
            .default_track()
            .ok_or_else(|| AudioError("No supported audio track".into()))?;
        let track_id = track.id;
        let rate = track
            .codec_params
            .sample_rate
            .ok_or_else(|| AudioError("Unknown audio sample rate".into()))?;
        let duration = track
            .codec_params
            .n_frames
            .map(|frames| frames as f64 / f64::from(rate))
            .unwrap_or(0.0);
        if rate == 0 {
            return Err(AudioError("Invalid zero audio sample rate".into()));
        }
        let time_base = track
            .codec_params
            .time_base
            .unwrap_or_else(|| TimeBase::new(1, rate));
        let decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
            .map_err(decode_error)?;
        if start > 0.0 {
            seek_to(&mut *format, start, track_id)?;
        }
        Ok(Self {
            format,
            decoder,
            track_id,
            rate,
            duration,
            discard_until: start,
            time_base,
        })
    }

    pub fn next(&mut self) -> Result<Option<Vec<[f32; 2]>>, AudioError> {
        loop {
            let packet = match self.format.next_packet() {
                Ok(packet) => packet,
                Err(Error::IoError(error)) if error.kind() == std::io::ErrorKind::UnexpectedEof => {
                    return Ok(None)
                }
                Err(error) => return Err(decode_error(error)),
            };
            if packet.track_id() != self.track_id {
                continue;
            }
            let decoded = self.decoder.decode(&packet).map_err(decode_error)?;
            let channels = decoded.spec().channels.count();
            if channels == 0 || channels > 2 {
                return Err(AudioError(
                    "Multichannel audio requires server stereo transcoding".into(),
                ));
            }
            if decoded.spec().rate != self.rate {
                return Err(AudioError(
                    "Midstream sample rate changes are unsupported".into(),
                ));
            }
            let mut buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
            buffer.copy_interleaved_ref(decoded);
            let skip =
                samples_before_seek(self.time_base, packet.ts(), self.discard_until, self.rate);
            let frames = buffer
                .samples()
                .chunks_exact(channels)
                .skip(skip)
                .map(|samples| [samples[0], samples[channels - 1]])
                .collect::<Vec<_>>();
            if frames.iter().flatten().any(|sample| !sample.is_finite()) {
                return Err(AudioError("Non-finite audio samples".into()));
            }
            if !frames.is_empty() {
                return Ok(Some(frames));
            }
        }
    }

    pub fn seek(&mut self, position: f64) -> Result<(), AudioError> {
        seek_to(&mut *self.format, position, self.track_id)?;
        self.decoder.reset();
        self.discard_until = position;
        Ok(())
    }
}

fn seek_to(format: &mut dyn FormatReader, start: f64, track_id: u32) -> Result<(), AudioError> {
    format
        .seek(
            SeekMode::Accurate,
            SeekTo::Time {
                time: Time::from(start),
                track_id: Some(track_id),
            },
        )
        .map_err(decode_error)?;
    Ok(())
}

fn decode_error(error: Error) -> AudioError {
    AudioError(format!("Audio decode failed: {error}"))
}

fn samples_before_seek(base: TimeBase, timestamp: u64, seek: f64, rate: u32) -> usize {
    let time = base.calc_time(timestamp);
    let packet_position = time.seconds as f64 + time.frac;
    ((seek - packet_position) * f64::from(rate))
        .round()
        .max(0.0) as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seek_uses_container_time_base_instead_of_assuming_sample_ticks() {
        assert_eq!(
            samples_before_seek(TimeBase::new(1, 1000), 250, 0.3, 48000),
            2400
        );
        assert_eq!(
            samples_before_seek(TimeBase::new(1, 48000), 12000, 0.3, 48000),
            2400
        );
        assert_eq!(
            samples_before_seek(TimeBase::new(1, 1000), 400, 0.3, 48000),
            0
        );
    }
}
