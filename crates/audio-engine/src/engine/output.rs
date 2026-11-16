use super::Engine;
use crate::{
    model::{AudioError, Settings},
    output::Output,
    worker::Target,
};
use std::sync::{atomic::Ordering, mpsc::Sender, Arc, Mutex};

impl Engine {
    pub(super) fn apply_settings(&mut self, settings: Settings) -> Result<(), AudioError> {
        settings.validate()?;
        let changed = self
            .settings
            .as_ref()
            .map(|_| self.current_settings())
            .transpose()?
            .is_none_or(|old| {
                old.device_id != settings.device_id
                    || old.exclusive != settings.exclusive
                    || old.sample_rate != settings.sample_rate
            });
        let rate = settings.sample_rate.or(if settings.exclusive {
            self.source_rate
        } else {
            None
        });
        if changed || self.output.is_none() || (rate.is_some() && self.output_request != rate) {
            self.replace_output(&settings, rate)?;
        }
        let gain = if settings.muted {
            0.0
        } else {
            f64::from(settings.volume / 100.0)
        };
        self.clock.gain.store(gain.to_bits(), Ordering::Release);
        self.clock
            .fade
            .store(settings.fade_on_pause, Ordering::Release);
        match &self.settings {
            Some(current) => {
                *current
                    .lock()
                    .map_err(|_| AudioError("Audio settings poisoned".into()))? = settings
            }
            None => self.settings = Some(Arc::new(Mutex::new(settings))),
        }
        Ok(())
    }

    fn replace_output(&mut self, settings: &Settings, rate: Option<u32>) -> Result<(), AudioError> {
        self.output_request = rate;
        self.output = None;
        self.producer = None;
        if settings.exclusive && rate.is_none() {
            return Ok(());
        }
        self.clock.failed.store(false, Ordering::Release);
        let (output, producer) = Output::open(
            settings.device_id.as_deref(),
            rate,
            settings.exclusive,
            self.clock.clone(),
        )?;
        self.output = Some(output);
        self.producer = Some(Arc::new(Mutex::new(producer)));
        Ok(())
    }

    pub(super) fn prepare_output(
        &mut self,
        rate: u32,
        response: Sender<Result<Target, AudioError>>,
    ) {
        self.source_rate = Some(rate);
        let result = self
            .current_settings()
            .and_then(|settings| self.apply_settings(settings))
            .and_then(|()| {
                let output = self
                    .output
                    .as_ref()
                    .ok_or_else(|| AudioError("Audio output is unavailable".into()))?;
                let producer = self
                    .producer
                    .as_ref()
                    .ok_or_else(|| AudioError("Audio buffer is unavailable".into()))?;
                Ok(Target {
                    rate: output.rate,
                    producer: producer.clone(),
                })
            });
        if let Err(error) = &result {
            self.error = Some(error.0.clone());
            self.pause(true);
        }
        let _ = response.send(result);
    }
}
