use crate::gain::GainRamp;
use crate::model::AudioError;
#[cfg(not(target_os = "windows"))]
use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::{FromSample, SizedSample};
#[cfg(any(test, not(target_os = "windows")))]
use ringbuf::{traits::Split, HeapRb};
use ringbuf::{
    traits::{Consumer, Producer},
    HeapCons, HeapProd,
};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};

#[derive(Clone, Copy)]
pub struct Frame {
    pub samples: [f32; 2],
    pub position: f64,
    pub generation: u64,
}

#[derive(Default)]
pub struct Clock {
    pub generation: AtomicU64,
    pub position: AtomicU64,
    pub paused: AtomicBool,
    pub gain: AtomicU64,
    pub consumed: AtomicU64,
    pub produced: AtomicU64,
    pub fade: AtomicBool,
    pub starved: AtomicBool,
    pub underruns: AtomicU64,
    pub failed: AtomicBool,
    pub latency: AtomicU64,
    pub finished: AtomicBool,
    pub started: AtomicBool,
}

pub struct Output {
    #[cfg(not(target_os = "windows"))]
    _stream: cpal::Stream,
    #[cfg(target_os = "windows")]
    _stream: crate::platform::WasapiOutput,
    pub clock: Arc<Clock>,
    pub rate: u32,
}

impl Clock {
    pub fn begin(&self, generation: u64, position: f64) {
        self.generation.store(generation, Ordering::Release);
        self.position.store(position.to_bits(), Ordering::Release);
        self.consumed.store(0, Ordering::Release);
        self.produced.store(0, Ordering::Release);
        self.finished.store(false, Ordering::Release);
        self.started.store(false, Ordering::Release);
        self.starved.store(false, Ordering::Release);
    }

    fn record_callback(&self, generation: u64, underrun: bool) {
        if generation != self.generation.load(Ordering::Acquire) {
            return;
        }
        if underrun
            && self.started.load(Ordering::Relaxed)
            && !self.finished.load(Ordering::Acquire)
        {
            self.underruns.fetch_add(1, Ordering::Relaxed);
        }
        self.starved.store(underrun, Ordering::Release);
    }
}

impl Output {
    #[cfg(target_os = "windows")]
    pub fn open(
        device_id: Option<&str>,
        sample_rate: Option<u32>,
        exclusive: bool,
        clock: Arc<Clock>,
    ) -> Result<(Self, HeapProd<Frame>), AudioError> {
        let (stream, producer, rate) =
            crate::platform::WasapiOutput::open(device_id, sample_rate, exclusive, clock.clone())?;
        Ok((
            Self {
                _stream: stream,
                clock,
                rate,
            },
            producer,
        ))
    }

    #[cfg(not(target_os = "windows"))]
    pub fn open(
        device_id: Option<&str>,
        sample_rate: Option<u32>,
        exclusive: bool,
        clock: Arc<Clock>,
    ) -> Result<(Self, HeapProd<Frame>), AudioError> {
        if exclusive {
            return Err(AudioError(
                "Exclusive output is not implemented on this platform".into(),
            ));
        }
        let device = crate::platform::output_device(device_id)?;
        let supported = match sample_rate {
            None => device.default_output_config()?,
            Some(rate) => device
                .supported_output_configs()?
                .find(|config| config.min_sample_rate() <= rate && config.max_sample_rate() >= rate)
                .ok_or_else(|| {
                    AudioError("Selected sample rate is unsupported by the output device".into())
                })?
                .with_sample_rate(rate),
        };
        let rate = supported.sample_rate();
        let (producer, consumer) = HeapRb::new(rate as usize / 10).split();
        let config = supported.config();
        let stream = match supported.sample_format() {
            cpal::SampleFormat::F32 => build::<f32>(&device, config, consumer, clock.clone()),
            cpal::SampleFormat::I16 => build::<i16>(&device, config, consumer, clock.clone()),
            cpal::SampleFormat::U16 => build::<u16>(&device, config, consumer, clock.clone()),
            cpal::SampleFormat::I32 => build::<i32>(&device, config, consumer, clock.clone()),
            _ => return Err(AudioError("Unsupported output sample format".into())),
        }?;
        stream.play()?;
        Ok((
            Self {
                _stream: stream,
                clock,
                rate,
            },
            producer,
        ))
    }
}

#[cfg(not(target_os = "windows"))]
fn build<T: SizedSample + FromSample<f32>>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    mut consumer: HeapCons<Frame>,
    clock: Arc<Clock>,
) -> Result<cpal::Stream, cpal::Error> {
    let channels = usize::from(config.channels);
    let rate = config.sample_rate;
    let mut gain = GainRamp::default();
    let failure = clock.clone();
    device.build_output_stream(
        config,
        move |data: &mut [T], info| {
            let timestamp = info.timestamp();
            let latency = timestamp
                .playback
                .duration_since(timestamp.callback)
                .as_secs_f64();
            clock.latency.store(latency.to_bits(), Ordering::Relaxed);
            render(data, channels, rate, &mut consumer, &clock, &mut gain);
        },
        move |_| {
            failure.failed.store(true, Ordering::Release);
        },
        None,
    )
}

pub(crate) fn render<T: SizedSample + FromSample<f32>>(
    data: &mut [T],
    channels: usize,
    rate: u32,
    consumer: &mut HeapCons<Frame>,
    clock: &Clock,
    ramp: &mut GainRamp,
) {
    let generation = clock.generation.load(Ordering::Acquire);
    data.fill(T::from_sample(0.0));
    discard_stale(consumer, generation);
    let gain = f64::from_bits(clock.gain.load(Ordering::Relaxed)) as f32;
    let paused = clock.paused.load(Ordering::Acquire);
    ramp.target(
        if paused { 0.0 } else { gain },
        paused,
        clock.fade.load(Ordering::Relaxed),
        rate,
    );
    let mut underrun = false;
    for output in data.chunks_mut(channels) {
        if generation != clock.generation.load(Ordering::Acquire) {
            return;
        }
        let gain = ramp.next();
        if paused && gain.abs() < 0.000001 {
            continue;
        }
        discard_stale(consumer, generation);
        if consumer
            .try_peek()
            .is_some_and(|frame| frame.generation > generation)
        {
            return;
        }
        if let Some(frame) = consumer.try_pop() {
            if generation != clock.generation.load(Ordering::Acquire) {
                return;
            }
            write_samples(output, frame.samples, gain);
            clock
                .position
                .store(frame.position.to_bits(), Ordering::Relaxed);
            if generation == clock.generation.load(Ordering::Acquire) {
                clock.consumed.fetch_add(1, Ordering::Relaxed);
            }
        } else {
            underrun = true;
        }
    }
    clock.record_callback(generation, underrun);
}

fn discard_stale(consumer: &mut HeapCons<Frame>, generation: u64) {
    while consumer
        .try_peek()
        .is_some_and(|frame| frame.generation < generation)
    {
        consumer.try_pop();
    }
}

fn write_samples<T: SizedSample + FromSample<f32>>(output: &mut [T], samples: [f32; 2], gain: f32) {
    let left = if output.len() == 1 {
        (samples[0] + samples[1]) * 0.5
    } else {
        samples[0]
    };
    output[0] = T::from_sample((left * gain).clamp(-1.0, 1.0));
    if output.len() > 1 {
        output[1] = T::from_sample((samples[1] * gain).clamp(-1.0, 1.0));
    }
}

pub fn push(
    producer: &mut HeapProd<Frame>,
    mut frame: Frame,
    cancel: &tokio_util::sync::CancellationToken,
    clock: &Clock,
) -> bool {
    loop {
        if cancel.is_cancelled() || frame.generation != clock.generation.load(Ordering::Acquire) {
            return false;
        }
        match producer.try_push(frame) {
            Ok(()) => return true,
            Err(returned) => frame = returned,
        }
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ringbuf::traits::Observer;

    #[test]
    fn paused_seek_discards_old_pcm_and_keeps_the_new_pcm_paused() {
        let (mut producer, mut consumer) = HeapRb::new(2).split();
        let clock = Clock::default();
        clock.paused.store(true, Ordering::Release);
        for _ in 0..2 {
            assert!(producer
                .try_push(Frame {
                    samples: [0.8; 2],
                    position: 1.0,
                    generation: 1
                })
                .is_ok());
        }
        clock.begin(2, 3.0);
        let mut data = [1.0_f32; 2];
        let mut ramp = GainRamp::default();
        render(&mut data, 2, 48000, &mut consumer, &clock, &mut ramp);
        assert_eq!(data, [0.0; 2]);
        assert!(consumer.is_empty());
        assert!(producer
            .try_push(Frame {
                samples: [0.2; 2],
                position: 3.01,
                generation: 2
            })
            .is_ok());
        render(&mut data, 2, 48000, &mut consumer, &clock, &mut ramp);
        assert_eq!(consumer.try_peek().unwrap().generation, 2);
        assert_eq!(f64::from_bits(clock.position.load(Ordering::Acquire)), 3.0);
        clock.paused.store(false, Ordering::Release);
        clock.gain.store(1.0_f64.to_bits(), Ordering::Release);
        render(&mut data, 2, 48000, &mut consumer, &clock, &mut ramp);
        assert!(consumer.is_empty());
        assert_eq!(f64::from_bits(clock.position.load(Ordering::Acquire)), 3.01);
    }

    #[test]
    fn seek_interrupts_backpressure_without_cancelling_the_download() {
        let (mut producer, _consumer) = HeapRb::new(1).split();
        let frame = Frame {
            samples: [0.2; 2],
            position: 1.0,
            generation: 1,
        };
        assert!(producer.try_push(frame).is_ok());
        let clock = Clock::default();
        clock.begin(2, 3.0);
        let cancel = tokio_util::sync::CancellationToken::new();
        assert!(!push(&mut producer, frame, &cancel, &clock));
        assert!(!cancel.is_cancelled());
    }
}
