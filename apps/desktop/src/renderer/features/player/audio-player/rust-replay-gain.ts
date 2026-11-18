import type { SettingsState } from '/@/renderer/store/settings.store';
import type { AudioSettings, AudioTrack } from '/@/shared/backend/audio';
import type { Song } from '/@/shared/types/domain-types';

export function replayGainSettings({
    replayGainClip,
    replayGainFallbackDB,
    replayGainMode,
    replayGainPreampDB,
}: SettingsState['playback']['mpvProperties']): AudioSettings['replayGain'] {
    return {
        clip: replayGainClip ?? true,
        fallbackDb: finite(replayGainFallbackDB),
        mode: replayGainMode ?? 'no',
        preampDb: finite(replayGainPreampDB) ?? 0,
    };
}

export function replayGainTags(song: Pick<Song, 'gain' | 'peak'>): AudioTrack['replayGain'] {
    return {
        albumGain: finite(song.gain?.album ?? undefined),
        albumPeak: peak(song.peak?.album ?? undefined),
        trackGain: finite(song.gain?.track ?? undefined),
        trackPeak: peak(song.peak?.track ?? undefined),
    };
}

function finite(value?: number): number | undefined {
    return Number.isFinite(value) ? value : undefined;
}

function peak(value?: number): number | undefined {
    return value !== undefined && value > 0 ? finite(value) : undefined;
}
