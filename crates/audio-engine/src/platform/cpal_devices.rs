use super::{DeviceError, OutputDevice};
use cpal::traits::{DeviceTrait, HostTrait};

pub(super) fn list(host: &cpal::Host) -> Result<Vec<OutputDevice>, DeviceError> {
    let default_id = host
        .default_output_device()
        .map(|device| device.id())
        .transpose()?;
    let mut devices = Vec::new();
    for device in host.output_devices()? {
        let id = device.id()?;
        let description = device.description()?;
        devices.push(OutputDevice {
            id: id.to_string(),
            name: description.name().to_owned(),
            is_default: default_id.as_ref() == Some(&id),
        });
    }
    Ok(devices)
}
