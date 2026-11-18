use crate::{
    effects::Effects,
    model::{AudioError, Settings},
    replay_gain::Tags,
    resample::Converter,
    tempo::Tempo,
};

pub(crate) struct Pipeline {
    converter: Converter,
    tempo: Option<Tempo>,
    effects: Effects,
    settings: Settings,
    input_rate: u32,
    rate: u32,
    gain_db: f32,
    replay_gain: Tags,
}

impl Pipeline {
    pub fn new(
        input_rate: u32,
        rate: u32,
        settings: Settings,
        gain_db: f32,
        replay_gain: Tags,
    ) -> Result<Self, AudioError> {
        let converter = Converter::new(
            input_rate,
            rate,
            if settings.preserve_pitch {
                1.0
            } else {
                settings.speed
            },
        )?;
        let tempo = (settings.preserve_pitch && settings.speed != 1.0)
            .then(|| Tempo::new(rate, settings.speed));
        let effects = Effects::new(
            rate,
            &settings,
            gain_db + settings.replay_gain.gain_db(replay_gain),
        )?;
        Ok(Self {
            converter,
            tempo,
            effects,
            settings,
            input_rate,
            rate,
            gain_db,
            replay_gain,
        })
    }

    pub fn process(
        &mut self,
        input: &[[f32; 2]],
        finish: bool,
        settings: &Settings,
    ) -> Result<Vec<[f32; 2]>, AudioError> {
        if settings.speed != self.settings.speed
            || settings.preserve_pitch != self.settings.preserve_pitch
        {
            *self = Self::new(
                self.input_rate,
                self.rate,
                settings.clone(),
                self.gain_db,
                self.replay_gain,
            )?;
        } else if settings.equalizer != self.settings.equalizer
            || settings.compressor != self.settings.compressor
            || settings.replay_gain != self.settings.replay_gain
        {
            self.effects = Effects::new(
                self.rate,
                settings,
                self.gain_db + settings.replay_gain.gain_db(self.replay_gain),
            )?;
            self.settings = settings.clone();
        }
        let output = self.converter.process(input, finish)?;
        let mut output = if let Some(tempo) = &mut self.tempo {
            let mut stretched = if output.is_empty() {
                Vec::new()
            } else {
                tempo.process(&output)
            };
            if finish {
                stretched.extend(tempo.finish());
            }
            stretched
        } else {
            output
        };
        self.effects.process(&mut output);
        Ok(output)
    }
}
