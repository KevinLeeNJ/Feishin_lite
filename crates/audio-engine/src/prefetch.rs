use crate::{
    decoder::DecoderStream,
    media::NetworkMedia,
    model::{AudioError, Track},
};
use std::{
    io::{Read, Seek, SeekFrom},
    sync::mpsc::Sender,
};
use tokio_util::sync::CancellationToken;

pub struct PreparedNext {
    pub track: Track,
    pub decoder: DecoderStream,
}

pub enum NextMessage {
    Prepared { sequence: u64, next: PreparedNext },
    Cancel { sequence: u64 },
}

pub fn spawn(
    runtime: &tokio::runtime::Runtime,
    track: Track,
    cancel: CancellationToken,
    nexts: Sender<NextMessage>,
    sequence: u64,
) {
    runtime.spawn(async move {
        let media = match NetworkMedia::open(&track.url, cancel.clone()).await {
            Ok(media) => media,
            Err(error) => return eprintln!("Audio prefetch failed: {error}"),
        };
        let prepared = tokio::task::spawn_blocking(move || prepare(media, track, cancel)).await;
        match prepared {
            Ok(Ok(next)) => {
                let _ = nexts.send(NextMessage::Prepared { sequence, next });
            }
            Ok(Err(error)) => eprintln!("Audio prefetch failed: {error}"),
            Err(error) => eprintln!("Audio prefetch task failed: {error}"),
        }
    });
}

fn prepare(
    mut media: NetworkMedia,
    track: Track,
    cancel: CancellationToken,
) -> Result<PreparedNext, AudioError> {
    let mut buffer = vec![0u8; 128 * 1024];
    loop {
        if cancel.is_cancelled() {
            return Err(AudioError("Cancelled".into()));
        }
        match media.read(&mut buffer) {
            Ok(0) => break,
            Ok(_) => {}
            Err(error) => return Err(AudioError(format!("Prefetch read failed: {error}"))),
        }
    }
    if cancel.is_cancelled() {
        return Err(AudioError("Cancelled".into()));
    }
    media
        .seek(SeekFrom::Start(0))
        .map_err(|error| AudioError(format!("Prefetch rewind failed: {error}")))?;
    let decoder = DecoderStream::open(Box::new(media), 0.0)?;
    Ok(PreparedNext { track, decoder })
}
