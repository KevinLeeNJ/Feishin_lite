#[derive(Default)]
pub struct GainRamp {
    pub value: f32,
    target: f32,
    step: f32,
    remaining: u32,
    paused: bool,
}

impl GainRamp {
    pub fn target(&mut self, target: f32, paused: bool, fade: bool, rate: u32) {
        if target != self.target {
            let seconds = if fade && paused != self.paused {
                0.3
            } else {
                0.005
            };
            self.remaining = (rate as f32 * seconds).max(1.0) as u32;
            self.step = (target - self.value) / self.remaining as f32;
            self.target = target;
        }
        self.paused = paused;
    }

    pub fn next(&mut self) -> f32 {
        if self.remaining > 0 {
            self.remaining -= 1;
            self.value = if self.remaining == 0 {
                self.target
            } else {
                self.value + self.step
            };
        }
        self.value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_fades_reach_exact_gain_and_can_be_interrupted() {
        let mut ramp = GainRamp::default();
        ramp.target(1.0, false, false, 48000);
        for _ in 0..240 {
            ramp.next();
        }
        assert_eq!(ramp.value, 1.0);
        ramp.target(0.0, true, true, 48000);
        for _ in 0..7200 {
            ramp.next();
        }
        assert!((ramp.value - 0.5).abs() < 0.001);
        ramp.target(0.25, false, true, 48000);
        for _ in 0..14400 {
            ramp.next();
        }
        assert_eq!(ramp.value, 0.25);
    }
}
