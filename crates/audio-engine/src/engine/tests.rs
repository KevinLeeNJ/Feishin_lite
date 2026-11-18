use super::*;
use crate::model::{Compressor, Equalizer, Transition};

fn settings() -> Settings {
    Settings {
        volume: 0.0,
        muted: true,
        speed: 1.0,
        preserve_pitch: true,
        sample_rate: None,
        exclusive: true,
        device_id: None,
        fade_on_pause: false,
        equalizer: Equalizer {
            enabled: false,
            preamp: 0.0,
            bands: vec![],
        },
        compressor: Compressor {
            enabled: false,
            threshold: -20.0,
            ratio: 1.0,
            attack: 10.0,
            release: 100.0,
            makeup: 0.0,
            knee: 0.0,
        },
        transition: Transition::default(),
        replay_gain: Default::default(),
    }
}

#[test]
fn exclusive_auto_transition_status_uses_source_rate_and_ignores_stale_prefetch() {
    let mut engine = Engine::new().unwrap();
    engine.configure(settings()).unwrap();
    assert!(engine.output.is_none());

    let (sender, receiver) = mpsc::channel();
    engine.updates = Some(receiver);
    engine.source_rate = Some(44_100);
    engine.prefetch_sequence = 2;
    sender.send(Update::NextSourceRate(2, 44_100)).unwrap();
    sender.send(Update::NextSourceRate(1, 96_000)).unwrap();
    assert!(!engine.snapshot().transition_rate_mismatch);

    sender.send(Update::NextSourceRate(2, 96_000)).unwrap();
    assert!(engine.snapshot().transition_rate_mismatch);
    let fixed_rate = Settings {
        sample_rate: Some(48_000),
        ..settings()
    };
    assert!(!fixed_rate.transition_rate_mismatch(44_100, 96_000));
    let shared = Settings {
        exclusive: false,
        ..settings()
    };
    assert!(!shared.transition_rate_mismatch(44_100, 96_000));
}
