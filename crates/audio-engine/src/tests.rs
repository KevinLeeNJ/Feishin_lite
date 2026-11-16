use crate::{decoder::DecoderStream, resample::Converter, tempo::Tempo};
use std::io::Cursor;

fn sine(frames: usize, rate: u32) -> Vec<[f32; 2]> {
    (0..frames)
        .map(|index| {
            let sample = (index as f32 * 440.0 * std::f32::consts::TAU / rate as f32).sin() * 0.2;
            [sample, sample]
        })
        .collect()
}

fn wav(frames: usize, rate: u32) -> Vec<u8> {
    let mut bytes = Vec::new();
    let size = frames as u32 * 4;
    bytes.extend(b"RIFF");
    bytes.extend((size + 36).to_le_bytes());
    bytes.extend(b"WAVEfmt ");
    bytes.extend(16_u32.to_le_bytes());
    bytes.extend(1_u16.to_le_bytes());
    bytes.extend(2_u16.to_le_bytes());
    bytes.extend(rate.to_le_bytes());
    bytes.extend((rate * 4).to_le_bytes());
    bytes.extend(4_u16.to_le_bytes());
    bytes.extend(16_u16.to_le_bytes());
    bytes.extend(b"data");
    bytes.extend(size.to_le_bytes());
    for frame in sine(frames, rate) {
        for sample in frame {
            bytes.extend(((sample * 32767.0) as i16).to_le_bytes());
        }
    }
    bytes
}

#[test]
fn decode_and_accurate_seek_preserve_duration() {
    for start in [0.0, 0.25, 0.75] {
        let mut decoder =
            DecoderStream::open(Box::new(Cursor::new(wav(48000, 48000))), start).unwrap();
        let mut count = 0;
        while let Some(frames) = decoder.next().unwrap() {
            count += frames.len();
        }
        assert_eq!(count, ((1.0 - start) * 48000.0) as usize);
        assert_eq!(decoder.duration, 1.0);
    }
}

#[test]
fn seek_reuses_the_decoder_for_forward_backward_zero_and_eof_targets() {
    let mut decoder = DecoderStream::open(Box::new(Cursor::new(wav(48000, 48000))), 0.0).unwrap();
    assert!(decoder.next().unwrap().is_some());
    for start in [0.75, 0.123, 0.0, 0.999, 0.5] {
        decoder.seek(start).unwrap();
        let mut count = 0;
        while let Some(frames) = decoder.next().unwrap() {
            count += frames.len();
        }
        assert_eq!(count, ((1.0 - start) * 48000.0).round() as usize);
    }
}

#[test]
fn resampling_preserves_frame_count_and_signal() {
    for rate in [16000, 44100, 48000, 96000] {
        let mut converter = Converter::new(rate, 48000, 1.0).unwrap();
        let mut output = Vec::new();
        for chunk in sine(rate as usize, rate).chunks(777) {
            output.extend(converter.process(chunk, false).unwrap());
        }
        output.extend(converter.process(&[], true).unwrap());
        assert_eq!(output.len(), 48000, "rate {rate}");
        assert!(output.iter().all(|frame| frame[0].is_finite()));
        assert!((frequency(&output, 48000) - 440.0).abs() < 3.0);
    }
}

#[test]
fn tempo_preserves_pitch_at_half_and_double_speed() {
    for speed in [0.5, 2.0] {
        let mut tempo = Tempo::new(48000, speed);
        let mut output = Vec::new();
        for chunk in sine(96000, 48000).chunks(1024) {
            output.extend(tempo.process(chunk));
        }
        output.extend(tempo.finish());
        assert_eq!(output.len(), (96000.0 / speed) as usize);
        assert!(
            (frequency(&output, 48000) - 440.0).abs() < 10.0,
            "speed {speed}: {}",
            frequency(&output, 48000)
        );
    }
}

fn frequency(frames: &[[f32; 2]], rate: u32) -> f64 {
    let frames = &frames[frames.len() / 4..frames.len() * 3 / 4];
    let crossings = frames
        .windows(2)
        .filter(|pair| pair[0][0] <= 0.0 && pair[1][0] > 0.0)
        .count();
    crossings as f64 * f64::from(rate) / frames.len() as f64
}
