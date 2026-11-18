import { replayGainSettings } from './rust-replay-gain';

import { usePlayerStore, useSettingsStore } from '/@/renderer/store';
import { AudioSettings, AudioTransition } from '/@/shared/backend/audio';
import { CrossfadeStyle, PlayerStyle } from '/@/shared/types/types';

export function audioSettings(): AudioSettings {
    const settings = useSettingsStore.getState().playback;
    const player = usePlayerStore.getState().player;
    return {
        compressor: {
            ...settings.compressor,
            enabled:
                settings.compressor.enabled && (settings.webAudio || settings.type === 'local'),
        },
        deviceId: settings.nativeAudioDeviceId ?? null,
        equalizer: {
            ...settings.equalizer,
            enabled: settings.equalizer.enabled && (settings.webAudio || settings.type === 'local'),
        },
        exclusive: settings.mpvProperties.audioExclusiveMode === 'yes',
        fadeOnPause: settings.audioFadeOnStatusChange,
        muted: player.muted,
        preservePitch: settings.preservePitch,
        replayGain: replayGainSettings(settings.mpvProperties),
        ...(settings.mpvProperties.audioSampleRateHz
            ? { sampleRate: settings.mpvProperties.audioSampleRateHz }
            : {}),
        speed: player.speed,
        transition: {
            crossfadeDuration: player.crossfadeDuration,
            crossfadeStyle: crossfadeCurve(player.crossfadeStyle),
            mode: transitionMode(player.transitionType),
        },
        volume: player.volume,
    };
}

function crossfadeCurve(style: CrossfadeStyle): AudioTransition['crossfadeStyle'] {
    switch (style) {
        case CrossfadeStyle.EXPONENTIAL:
            return 'exponential';
        case CrossfadeStyle.LINEAR:
            return 'linear';
        case CrossfadeStyle.S_CURVE:
            return 'sCurve';
        default:
            return 'equalPower';
    }
}

function transitionMode(style: PlayerStyle): AudioTransition['mode'] {
    switch (style) {
        case PlayerStyle.CROSSFADE:
            return 'crossfade';
        case PlayerStyle.NONE:
            return 'none';
        default:
            return 'gapless';
    }
}
