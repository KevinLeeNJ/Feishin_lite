import type { AudioCommand } from '/@/shared/backend/audio';

// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
    commands: [] as AudioCommand[],
    listeners: new Set<() => void>(),
    nextSong: undefined as
        | undefined
        | { _serverId: string; _uniqueId: string; duration: number; gain?: { album: number } },
    player: {
        crossfadeDuration: 5,
        crossfadeStyle: 'equalPower',
        muted: false,
        pauseOnNextSongEnd: false,
        repeat: 'none',
        speed: 1,
        status: 'playing',
        transitionType: 'gapless',
        volume: 80,
    },
    settings: { mpvProperties: {}, type: 'web' },
    song: {
        _serverId: 'server',
        _uniqueId: 'song-a',
        duration: 100,
        gain: { track: -7 },
        peak: { track: 0.9 },
    },
}));

vi.mock('i18next', () => ({ default: { t: (key: string) => key }, t: (key: string) => key }));
vi.mock('./hooks/use-player-events', () => ({ usePlayerEvents: () => {} }));
vi.mock('./hooks/use-stream-url', () => ({
    getSongUrl: async () => 'https://music/audio',
}));
vi.mock('./native-device', () => ({ initializeNativeDevice: async () => {} }));
vi.mock('./native-playback-clock', () => ({
    clearNativePlaybackClock: vi.fn(),
    freezeNativePlaybackClock: vi.fn(),
    updateNativePlaybackClock: vi.fn(),
}));
vi.mock('/@/renderer/store', async () => {
    const { useSyncExternalStore } = await import('react');
    const state = () => ({
        getCurrentSong: () => fixture.song,
        mediaAutoNext: vi.fn(),
        mediaPause: vi.fn(),
        player: fixture.player,
    });
    const subscribe = (listener: () => void) => {
        fixture.listeners.add(listener);
        return () => {
            fixture.listeners.delete(listener);
        };
    };
    return {
        setTimestamp: vi.fn(),
        usePlaybackSettings: () => fixture.settings,
        usePlayerData: () => ({
            currentSong: fixture.song,
            nextSong: fixture.nextSong,
            status: fixture.player.status,
        }),
        usePlayerStore: Object.assign(
            (selector: (value: ReturnType<typeof state>) => unknown) =>
                useSyncExternalStore(subscribe, () => selector(state())),
            { getState: state },
        ),
        useSettingsStore: {
            getState: () => ({
                playback: {
                    audioFadeOnStatusChange: false,
                    compressor: { enabled: false },
                    equalizer: { enabled: false },
                    mpvProperties: {
                        audioExclusiveMode: 'no',
                        audioSampleRateHz: 0,
                        replayGainMode: 'track',
                    },
                    preservePitch: true,
                    transcode: {},
                    type: 'web',
                    webAudio: false,
                },
            }),
        },
        useTimestampStoreBase: { getState: () => ({ timestamp: 0 }) },
    };
});
vi.mock('/@/renderer/utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('/@/shared/components/toast/toast', () => ({ toast: { error: vi.fn() } }));

import { RustPlayer } from './rust-player';

const configureTransitions = () =>
    fixture.commands.flatMap((command) =>
        command.method === 'configure' ? [command.params.transition] : [],
    );

beforeEach(() => {
    fixture.commands.length = 0;
    fixture.nextSong = undefined;
    fixture.player.transitionType = 'gapless';
    fixture.player.crossfadeDuration = 5;
    (window as unknown as { api: unknown }).api = {
        hostBridge: {
            audio: {
                command: async (command: AudioCommand) => {
                    fixture.commands.push(command);
                },
                snapshot: async () => ({ instanceId: null, queueRevision: 0 }),
            },
        },
    };
});

afterEach(() => {
    cleanup();
    fixture.listeners.clear();
});

it('re-configures the native engine when transition settings change mid-playback', async () => {
    render(<RustPlayer />);
    await waitFor(() => {
        expect(configureTransitions().at(-1)?.mode).toBe('gapless');
    });

    act(() => {
        fixture.player.transitionType = 'crossfade';
        fixture.player.crossfadeDuration = 8;
        for (const listener of fixture.listeners) listener();
    });

    await waitFor(() => {
        const last = configureTransitions().at(-1);
        expect(last?.mode).toBe('crossfade');
        expect(last?.crossfadeDuration).toBe(8);
    });
});

it('switching to none mid-playback cancels the prefetch and re-configures', async () => {
    fixture.nextSong = { _serverId: 'server', _uniqueId: 'song-b', duration: 80 };
    render(<RustPlayer />);
    const preparedTracks = () =>
        fixture.commands.flatMap((command) =>
            command.method === 'prepareNext' ? [command.params.track] : [],
        );
    await waitFor(() => {
        expect(preparedTracks().some((track) => track !== null)).toBe(true);
    });

    act(() => {
        fixture.player.transitionType = 'none';
        for (const listener of fixture.listeners) listener();
    });

    await waitFor(() => {
        expect(configureTransitions().at(-1)?.mode).toBe('none');
        expect(preparedTracks().at(-1)).toBeNull();
    });
});

it('sends ReplayGain tags for both the current and the prepared track', async () => {
    fixture.nextSong = {
        _serverId: 'server',
        _uniqueId: 'song-b',
        duration: 80,
        gain: { album: -5 },
    };
    render(<RustPlayer />);
    await waitFor(() => {
        expect(fixture.commands.find(({ method }) => method === 'load')).toMatchObject({
            params: {
                settings: { replayGain: { mode: 'track' } },
                track: { replayGain: { trackGain: -7, trackPeak: 0.9 } },
            },
        });
        expect(fixture.commands.find(({ method }) => method === 'prepareNext')).toMatchObject({
            params: { track: { replayGain: { albumGain: -5 } } },
        });
    });
});
