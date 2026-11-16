use crate::model::AudioError;
use std::{
    io::{self, Read, Seek, SeekFrom},
    num::NonZeroUsize,
    time::Duration,
};
use stream_download::{
    http::{reqwest::Client, HttpStream},
    source::SourceStream,
    storage::{adaptive::AdaptiveStorageProvider, temp::TempStorageProvider},
    Settings, StreamDownload,
};
use symphonia::core::io::MediaSource;
use tokio_util::sync::CancellationToken;

type Storage = AdaptiveStorageProvider<TempStorageProvider, TempStorageProvider>;
pub struct NetworkMedia {
    reader: StreamDownload<Storage>,
    cancellation: tokio::task::JoinHandle<()>,
}

impl NetworkMedia {
    pub async fn open(url: &str, cancel: CancellationToken) -> Result<Self, AudioError> {
        let url: stream_download::http::reqwest::Url = url
            .parse()
            .map_err(|_| AudioError("Invalid audio URL".into()))?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err(AudioError("Only HTTP audio streams are permitted".into()));
        }
        let stream = tokio::select! {
            _ = cancel.cancelled() => return Err(AudioError("Cancelled".into())),
            result = tokio::time::timeout(Duration::from_secs(20), HttpStream::<Client>::create(url)) =>
                result.map_err(|_| AudioError("Audio connection timed out".into()))?
                    .map_err(|_| AudioError("Unable to open audio stream".into()))?,
        };
        if stream
            .content_length()
            .is_some_and(|size| size > 512 * 1024 * 1024)
        {
            return Err(AudioError(
                "Audio stream exceeds the 512 MiB cache budget".into(),
            ));
        }
        let storage = Storage::new(
            TempStorageProvider::new(),
            NonZeroUsize::new(8 * 1024 * 1024).expect("nonzero"),
        );
        let settings = Settings::default()
            .prefetch_bytes(64 * 1024)
            .retry_timeout(Duration::from_secs(5))
            .on_progress(|_, state, cancel| {
                if state.current_position > 512 * 1024 * 1024 {
                    cancel.cancel();
                }
            });
        let reader = StreamDownload::from_stream(stream, storage, settings)
            .await
            .map_err(|_| AudioError("Unable to buffer audio stream".into()))?;
        let download_cancel = reader.cancellation_token();
        let cancellation = tokio::spawn(async move {
            cancel.cancelled().await;
            download_cancel.cancel();
        });
        Ok(Self {
            reader,
            cancellation,
        })
    }
}

impl Read for NetworkMedia {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        self.reader.read(buffer)
    }
}
impl Seek for NetworkMedia {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        self.reader.seek(position)
    }
}
impl MediaSource for NetworkMedia {
    fn is_seekable(&self) -> bool {
        true
    }
    fn byte_len(&self) -> Option<u64> {
        self.reader.content_length()
    }
}
impl Drop for NetworkMedia {
    fn drop(&mut self) {
        self.cancellation.abort();
    }
}
