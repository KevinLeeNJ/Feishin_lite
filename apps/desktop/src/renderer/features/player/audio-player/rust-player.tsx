import { t } from 'i18next';
import { useEffect } from 'react';

import { usePlayerEvents } from './hooks/use-player-events';
import { getSongUrl } from './hooks/use-stream-url';
import { initializeNativeDevice } from './native-device';
import {
    clearNativePlaybackClock,
    freezeNativePlaybackClock,
    updateNativePlaybackClock,
} from './native-playback-clock';
import { RustPlaybackSession } from './rust-playback-session';

import {
    setTimestamp,
    usePlaybackSettings,
    usePlayerData,
    usePlayerStore,
    useSettingsStore,
    useTimestampStoreBase,
} from '/@/renderer/store';
import { logger } from '/@/renderer/utils/logger';
import { AudioSettings } from '/@/shared/backend/audio';
import { toast } from '/@/shared/components/toast/toast';
import { PlayerStatus } from '/@/shared/types/types';

let requestedSongKey: string | undefined;
let fallbackForKey: string | undefined;

function audioSettings(): AudioSettings {
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
        ...(settings.mpvProperties.audioSampleRateHz
            ? { sampleRate: settings.mpvProperties.audioSampleRateHz }
            : {}),
        speed: player.speed,
        volume: player.volume,
    };
}

let session: RustPlaybackSession | undefined;

export function RustPlayer() {
    const { currentSong, status } = usePlayerData();
    const settings = usePlaybackSettings();
    useRustSession();
    useRustTrack(currentSong);
    useRustSettings(status, settings);
    useRustControls();
    useRustProgress(currentSong?._uniqueId);
    return null;
}

async function loadCurrent(force = false, forceTranscode = false): Promise<void> {
    const current = session;
    const state = usePlayerStore.getState();
    const song = state.getCurrentSong();
    if (!current || !song) {
        return;
    }
    const key = `${song._serverId}/${song._uniqueId}`;
    if (!forceTranscode && requestedSongKey === key) {
        if (force) {
            clearNativePlaybackClock();
            await current.restart(
                useTimestampStoreBase.getState().timestamp,
                state.player.status !== PlayerStatus.PLAYING,
            );
        }
        return;
    }
    requestedSongKey = key;
    fallbackForKey = forceTranscode ? key : undefined;
    clearNativePlaybackClock();
    const transcode = useSettingsStore.getState().playback.transcode;
    await current.load(
        { duration: song.duration, gainDb: 0 },
        async () => {
            await initializeNativeDevice();
            await current.configure(audioSettings());
            return getSongUrl(
                song,
                forceTranscode ? { ...transcode, enabled: true, format: 'flac' } : transcode,
            );
        },
        useTimestampStoreBase.getState().timestamp,
        state.player.status !== PlayerStatus.PLAYING,
        audioSettings(),
    );
}

function reportError(error: unknown): void {
    logger.error('Rust playback failed', { error });
    requestedSongKey = undefined;
    void session
        ?.stop()
        .catch((failure: unknown) => logger.error('Rust audio stop failed', { error: failure }));
    usePlayerStore.getState().mediaPause();
    toast.error({
        id: 'audio-playback-error',
        message: error instanceof Error ? error.message : t('error.playbackError'),
        title: t('error.playbackError'),
    });
}

async function updateProgress(progress: { endedInstance: null | string }): Promise<void> {
    const current = session;
    const snapshot = await current?.poll();
    if (!snapshot || current !== session) {
        return;
    }
    if (snapshot.error) {
        if (
            /unsupported|no supported|multichannel/i.test(snapshot.error) &&
            fallbackForKey !== requestedSongKey
        ) {
            logger.warn('Native decoder requires server transcoding');
            await loadCurrent(true, true);
            return;
        }
        throw new Error(snapshot.error);
    }
    setTimestamp(snapshot.position);
    updateNativePlaybackClock(snapshot, usePlayerStore.getState().player.speed);
    if (!snapshot.ended) {
        progress.endedInstance = null;
    }
    if (
        snapshot.ended &&
        snapshot.instanceId !== progress.endedInstance &&
        usePlayerStore.getState().player.status === PlayerStatus.PLAYING
    ) {
        progress.endedInstance = snapshot.instanceId;
        usePlayerStore.getState().mediaAutoNext();
    }
}

function useRustControls(): void {
    usePlayerEvents(
        {
            onPlayerMute: () => {
                void session?.configure(audioSettings()).catch(reportError);
            },
            onPlayerPlay: () => {
                void loadCurrent(true).catch(reportError);
            },
            onPlayerRepeated: () => {
                void loadCurrent(true).catch(reportError);
            },
            onPlayerSeekToTimestamp: ({ timestamp }) => {
                clearNativePlaybackClock();
                void session?.seek(timestamp).catch(reportError);
            },
            onPlayerSpeed: () => {
                void session?.configure(audioSettings()).catch(reportError);
            },
            onPlayerStop: () => {
                void session?.pause(true).catch(reportError);
            },
            onPlayerVolume: () => {
                void session?.configure(audioSettings()).catch(reportError);
            },
            onQueueCleared: () => {
                void session?.stop().catch(reportError);
            },
        },
        [],
    );
}

function useRustProgress(songId: string | undefined): void {
    useEffect(() => {
        let cancelled = false;
        let pending = false;
        const progress: { endedInstance: null | string } = { endedInstance: null };
        const timer = setInterval(() => {
            if (cancelled || pending) {
                return;
            }
            pending = true;
            void updateProgress(progress)
                .catch((error: unknown) => {
                    if (!cancelled) {
                        reportError(error);
                    }
                })
                .finally(() => {
                    pending = false;
                });
        }, 100);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [songId]);
}

function useRustSession(): void {
    useEffect(() => {
        const current = new RustPlaybackSession(window.api.hostBridge.audio);
        session = current;
        requestedSongKey = undefined;
        return () => {
            clearNativePlaybackClock();
            if (session === current) {
                session = undefined;
            }
            void current
                .dispose()
                .catch((error: unknown) => logger.error('Rust player cleanup failed', { error }));
        };
    }, []);
}

function useRustSettings(
    status: PlayerStatus,
    settings: ReturnType<typeof usePlaybackSettings>,
): void {
    useEffect(() => {
        if (status !== PlayerStatus.PLAYING) {
            freezeNativePlaybackClock();
        }
        void session?.pause(status !== PlayerStatus.PLAYING).catch(reportError);
    }, [status]);
    useEffect(() => {
        void session?.configure(audioSettings()).catch(reportError);
    }, [settings]);
}

function useRustTrack(song: ReturnType<typeof usePlayerData>['currentSong']): void {
    useEffect(() => {
        if (song) {
            void loadCurrent().catch(reportError);
        } else {
            requestedSongKey = undefined;
            void session?.stop().catch(reportError);
        }
    }, [song]);
}
