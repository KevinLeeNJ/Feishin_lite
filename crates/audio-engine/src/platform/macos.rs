pub(super) fn audio_host() -> Result<cpal::Host, cpal::Error> {
    cpal::host_from_id(cpal::HostId::CoreAudio)
}
