pub(super) fn audio_host() -> Result<cpal::Host, cpal::Error> {
    cpal::host_from_id(cpal::HostId::Wasapi)
}

mod format;
mod pcm;

use crate::{
    model::AudioError,
    output::{Clock, Frame},
};
use ringbuf::{traits::Split, HeapProd, HeapRb};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread::{self, JoinHandle},
    time::Duration,
};
use wasapi::{AudioClient, DeviceEnumerator, Direction, StreamMode, WaveFormat};

pub(crate) struct WasapiOutput {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl WasapiOutput {
    pub fn open(
        id: Option<&str>,
        rate: Option<u32>,
        exclusive: bool,
        clock: Arc<Clock>,
    ) -> Result<(Self, HeapProd<Frame>, u32), AudioError> {
        let id = id.map(str::to_owned);
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = stop.clone();
        let (ready, result) = mpsc::sync_channel(1);
        let thread = thread::Builder::new()
            .name("wasapi-output".into())
            .spawn(move || {
                let outcome = run(id.as_deref(), rate, exclusive, &clock, &stopping, &ready);
                if let Err(error) = outcome {
                    clock.failed.store(true, Ordering::Release);
                    let _ = ready.send(Err(error));
                }
            })
            .map_err(|error| AudioError(error.to_string()))?;
        let stream = Self {
            stop,
            thread: Some(thread),
        };
        let (producer, rate) = result
            .recv()
            .map_err(|error| AudioError(error.to_string()))??;
        Ok((stream, producer, rate))
    }
}

impl Drop for WasapiOutput {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            if thread.join().is_err() {
                eprintln!("WASAPI output thread panicked");
            }
        }
    }
}

struct ComApartment;
impl Drop for ComApartment {
    fn drop(&mut self) {
        wasapi::deinitialize();
    }
}

fn run(
    id: Option<&str>,
    rate: Option<u32>,
    exclusive: bool,
    clock: &Arc<Clock>,
    stop: &AtomicBool,
    ready: &mpsc::SyncSender<Result<(HeapProd<Frame>, u32), AudioError>>,
) -> Result<(), AudioError> {
    wasapi::initialize_mta()
        .ok()
        .map_err(|error| AudioError(error.to_string()))?;
    let _apartment = ComApartment;
    let (client, format) = initialize_client(id, rate, exclusive)?;
    let rate = format.get_samplespersec();
    let (producer, mut consumer) = HeapRb::new(rate as usize / 10).split();
    let mut buffer = pcm::Buffer::new(&format, client.get_buffer_size()? as usize, exclusive);
    let render_client = client.get_audiorenderclient()?;
    buffer.write(&client, &render_client, &mut consumer, clock)?;
    client.start_stream()?;
    ready
        .send(Ok((producer, rate)))
        .map_err(|error| AudioError(error.to_string()))?;
    while !stop.load(Ordering::Acquire) {
        buffer.write(&client, &render_client, &mut consumer, clock)?;
        thread::sleep(Duration::from_millis(2));
    }
    client.stop_stream()?;
    Ok(())
}

fn initialize_client(
    id: Option<&str>,
    rate: Option<u32>,
    exclusive: bool,
) -> Result<(AudioClient, WaveFormat), AudioError> {
    let mut client = open_client(id)?;
    let format = format::select(&client, rate, exclusive)?;
    let rate = format.get_samplespersec();
    let (period, _) = client.get_device_period()?;
    let mode = if exclusive {
        StreamMode::PollingExclusive {
            period_hns: period,
            buffer_duration_hns: period * 2,
        }
    } else {
        StreamMode::PollingShared {
            autoconvert: true,
            buffer_duration_hns: period * 2,
        }
    };
    client
        .initialize_client(&format, Direction::Render, mode, None)
        .map_err(|error| {
            AudioError(format!(
                "WASAPI {} at {rate} Hz: {error}",
                if exclusive { "exclusive" } else { "shared" }
            ))
        })?;
    Ok((client, format))
}

fn open_client(id: Option<&str>) -> Result<AudioClient, AudioError> {
    let enumerator = DeviceEnumerator::new()?;
    let device = match id.filter(|id| !id.is_empty() && *id != "auto" && *id != "default") {
        Some(id) => {
            let parsed = id.parse::<cpal::DeviceId>()?;
            enumerator.get_device(parsed.id())?
        }
        None => enumerator.get_default_device(Direction::Render)?,
    };
    Ok(device.get_iaudioclient()?)
}

impl From<wasapi::WasapiError> for AudioError {
    fn from(error: wasapi::WasapiError) -> Self {
        Self(error.to_string())
    }
}
