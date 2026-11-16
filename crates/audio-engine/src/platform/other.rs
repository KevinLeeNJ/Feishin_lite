pub(super) fn audio_host() -> Result<cpal::Host, cpal::Error> {
    Ok(cpal::default_host())
}
