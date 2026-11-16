import { afterEach, expect, it, vi } from 'vitest';

import { AudioCommand } from '/@/shared/backend/audio';

const fixture = vi.hoisted(() => ({
    callbacks: {} as Record<string, (event?: { timestamp: number }) => void>,
    cleanups: [] as (() => void)[],
    commands: [] as AudioCommand[],
    song: { _serverId: 'server', _uniqueId: 'only-song', duration: 100 },
    status: 'playing',
    timestamp: 0,
    url: vi.fn(async () => 'https://music/audio'),
}));

vi.mock('react', () => ({
    useEffect: (effect: () => (() => void) | void) => {
        const cleanup = effect();
        if (cleanup) fixture.cleanups.push(cleanup);
    },
}));
vi.mock('i18next', () => ({
    default: { t: (key: string) => key },
    t: (key: string) => key,
}));
vi.mock('./hooks/use-player-events', () => ({
    usePlayerEvents: (callbacks: typeof fixture.callbacks) => {
        fixture.callbacks = callbacks;
    },
}));
vi.mock('./hooks/use-stream-url', () => ({ getSongUrl: fixture.url }));
vi.mock('./native-device', () => ({ initializeNativeDevice: async () => {} }));
vi.mock('./native-playback-clock', () => ({
    clearNativePlaybackClock: vi.fn(),
    freezeNativePlaybackClock: vi.fn(),
    updateNativePlaybackClock: vi.fn(),
}));
vi.mock('/@/renderer/store', () => ({
    setTimestamp: vi.fn(),
    usePlaybackSettings: () => ({}),
    usePlayerData: () => ({ currentSong: fixture.song, status: fixture.status }),
    usePlayerStore: {
        getState: () => ({
            getCurrentSong: () => fixture.song,
            player: { muted: true, speed: 1, status: fixture.status, volume: 0 },
        }),
    },
    useSettingsStore: {
        getState: () => ({
            playback: {
                compressor: { enabled: false },
                equalizer: { enabled: false },
                mpvProperties: { audioExclusiveMode: 'no', audioSampleRateHz: 0 },
                transcode: {},
            },
        }),
    },
    useTimestampStoreBase: { getState: () => ({ timestamp: fixture.timestamp }) },
}));
vi.mock('/@/renderer/utils/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('/@/shared/components/toast/toast', () => ({ toast: { error: vi.fn() } }));

import { RustPlayer } from './rust-player';

afterEach(() => {
    for (const cleanup of fixture.cleanups.splice(0)) cleanup();
    vi.unstubAllGlobals();
});

it('reuses the loaded song after next reaches the end of a one-song queue', async () => {
    vi.stubGlobal('window', {
        api: {
            hostBridge: {
                audio: {
                    command: async (command: AudioCommand) => {
                        fixture.commands.push(command);
                    },
                    snapshot: async () => ({ instanceId: null, queueRevision: 0 }),
                },
            },
        },
    });
    RustPlayer();
    await vi.waitFor(() => expect(fixture.commands.at(-1)?.method).toBe('setPaused'));
    const initial = fixture.commands.find((command) => command.method === 'load');
    expect(initial).toBeDefined();

    // Queue-end next resets the timestamp, seeks, then emits PLAYER_STOP.
    fixture.status = 'stopped';
    fixture.callbacks.onPlayerSeekToTimestamp({ timestamp: 0 });
    fixture.callbacks.onPlayerStop();
    await vi.waitFor(() =>
        expect(fixture.commands.at(-1)).toEqual({
            method: 'setPaused',
            params: { paused: true },
        }),
    );

    // Toggle from STOPPED emits PLAYER_PLAY for the same queue entry.
    fixture.commands.length = 0;
    fixture.status = 'playing';
    fixture.callbacks.onPlayerPlay();
    await vi.waitFor(() =>
        expect(fixture.commands).toEqual([
            { method: 'seek', params: { position: 0 } },
            { method: 'setPaused', params: { paused: false } },
        ]),
    );
    expect(fixture.url).toHaveBeenCalledOnce();

    // Repeat-one and double-clicking the same queue entry reuse it too.
    fixture.commands.length = 0;
    fixture.callbacks.onPlayerRepeated();
    await vi.waitFor(() => expect(fixture.commands).toHaveLength(2));
    expect(fixture.commands[0]).toEqual({ method: 'seek', params: { position: 0 } });
    expect(fixture.url).toHaveBeenCalledOnce();
});
