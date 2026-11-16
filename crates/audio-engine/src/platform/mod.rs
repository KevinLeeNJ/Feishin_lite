mod cpal_devices;
#[cfg(not(target_os = "windows"))]
use cpal::traits::{DeviceTrait, HostTrait};

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
use windows as host;
#[cfg(target_os = "windows")]
pub(crate) use windows::WasapiOutput;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos as host;

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
mod other;
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
use other as host;

pub struct OutputDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug)]
pub struct DeviceError(String);

impl std::fmt::Display for DeviceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for DeviceError {}

impl From<cpal::Error> for DeviceError {
    fn from(error: cpal::Error) -> Self {
        Self(error.to_string())
    }
}

pub fn list_output_devices() -> Result<Vec<OutputDevice>, DeviceError> {
    let host = host::audio_host()?;
    cpal_devices::list(&host)
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn output_device(id: Option<&str>) -> Result<cpal::Device, crate::model::AudioError> {
    let host = host::audio_host()?;
    if let Some(id) = id.filter(|id| !id.is_empty() && *id != "default" && *id != "auto") {
        for device in host.output_devices()? {
            if device.id()?.to_string() == id {
                return Ok(device);
            }
        }
        return Err(crate::model::AudioError(
            "Selected output device is unavailable".into(),
        ));
    }
    host.default_output_device()
        .ok_or_else(|| crate::model::AudioError("No default output device".into()))
}
