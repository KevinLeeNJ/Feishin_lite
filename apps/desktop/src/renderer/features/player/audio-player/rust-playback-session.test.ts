import { describe, expect, it, vi } from 'vitest';

import { RustPlaybackPort, RustPlaybackSession } from './rust-playback-session';

import { AudioCommand, AudioSettings, AudioSnapshot } from '/@/shared/backend/audio';

const settings: AudioSettings = {
    compressor: {
        attack: 10,
        enabled: false,
        knee: 6,
        makeup: 0,
        ratio: 4,
        release: 100,
        threshold: -24,
    },
    deviceId: null,
    equalizer: { bands: [], enabled: false, preamp: 0 },
    fadeOnPause: false,
    muted: false,
    preservePitch: true,
    speed: 1,
    volume: 50,
};

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((accept) => {
        resolve = accept;
    });
    return { promise, resolve };
}

function fixture() {
    const commands: AudioCommand[] = [];
    const pendingSnapshot = deferred<AudioSnapshot>();
    const port: RustPlaybackPort = {
        command: vi.fn(async (command) => {
            commands.push(command);
        }),
        snapshot: vi.fn(() => pendingSnapshot.promise),
    };
    return { commands, pendingSnapshot, port, session: new RustPlaybackSession(port) };
}

function snapshot(track: { instanceId: string; queueRevision: number }): AudioSnapshot {
    return {
        ...track,
        buffering: false,
        duration: 100,
        ended: false,
        error: null,
        outputLatencyMs: 10,
        paused: false,
        position: 1,
        sampleRate: 48000,
        underruns: 0,
    };
}

describe('Rust playback race isolation', () => {
    it('honors a pause requested while restart is seeking', async () => {
        const { commands, port, session } = fixture();
        await session.load(
            { duration: 100, gainDb: 0 },
            async () => 'https://music/audio',
            0,
            true,
            settings,
        );
        const seek = deferred<void>();
        vi.mocked(port.command).mockImplementationOnce(() => seek.promise);
        const restarting = session.restart(0, false);
        await session.pause(true);
        seek.resolve();
        await restarting;
        expect(commands.at(-1)).toEqual({ method: 'setPaused', params: { paused: true } });
    });

    it('restarts a stopped track without resolving its URL or loading again', async () => {
        const { commands, pendingSnapshot, session } = fixture();
        const resolveUrl = vi.fn(async () => 'https://music/audio');
        await session.load({ duration: 100, gainDb: 0 }, resolveUrl, 0, false, settings);
        const load = commands.find((command) => command.method === 'load');
        if (!load) throw new Error('Expected load');
        await session.seek(0);
        await session.pause(true);
        const poll = session.poll();
        commands.length = 0;
        await session.restart(0, false);
        pendingSnapshot.resolve({ ...snapshot(load.params.track), ended: true });
        expect(await poll).toBeUndefined();
        expect(resolveUrl).toHaveBeenCalledOnce();
        expect(commands).toEqual([
            { method: 'seek', params: { position: 0 } },
            { method: 'setPaused', params: { paused: false } },
        ]);
    });

    it('restarts while the initial URL is pending without duplicating the load', async () => {
        const { commands, session } = fixture();
        const url = deferred<string>();
        const loading = session.load(
            { duration: 100, gainDb: 0 },
            () => url.promise,
            5,
            true,
            settings,
        );
        await session.restart(0, false);
        url.resolve('https://music/audio');
        await loading;
        const loads = commands.filter((command) => command.method === 'load');
        expect(loads).toHaveLength(1);
        expect(loads[0].params.start).toBe(0);
        expect(loads[0].params.paused).toBe(false);
    });

    it('does not load a late URL from the previous track', async () => {
        const { commands, session } = fixture();
        const late = deferred<string>();
        const first = session.load(
            { duration: 100, gainDb: 0 },
            () => late.promise,
            0,
            false,
            settings,
        );
        await session.load(
            { duration: 100, gainDb: 0 },
            async () => 'https://b/audio',
            0,
            false,
            settings,
        );
        late.resolve('https://a/audio');
        await first;
        const loads = commands.filter((command) => command.method === 'load');
        expect(loads).toHaveLength(1);
        expect(loads[0].params.track.url).toBe('https://b/audio');
    });

    it('applies seeks, pause and settings received while resolving the URL', async () => {
        const { commands, session } = fixture();
        const url = deferred<string>();
        const loading = session.load(
            { duration: 100, gainDb: 0 },
            () => url.promise,
            0,
            false,
            settings,
        );
        await session.seek(42);
        await session.pause(true);
        await session.configure({ ...settings, volume: 20 });
        url.resolve('https://music/audio');
        await loading;
        const load = commands.find((command) => command.method === 'load');
        expect(load?.params.start).toBe(42);
        expect(load?.params.paused).toBe(true);
        expect(load?.params.settings.volume).toBe(20);
    });

    it('discards a snapshot requested before a seek', async () => {
        const { commands, pendingSnapshot, session } = fixture();
        await session.load(
            { duration: 100, gainDb: 0 },
            async () => 'https://music/audio',
            0,
            false,
            settings,
        );
        const load = commands.find((command) => command.method === 'load');
        if (!load) {
            throw new Error('Expected load');
        }
        const poll = session.poll();
        await session.seek(20);
        pendingSnapshot.resolve(snapshot(load.params.track));
        expect(await poll).toBeUndefined();
    });

    it.each([{ sampleRate: 96000 }, { exclusive: true }])(
        'discards snapshots pending an output change: %o',
        async (change) => {
            const { commands, pendingSnapshot, session } = fixture();
            await session.load(
                { duration: 100, gainDb: 0 },
                async () => 'https://music/audio',
                0,
                false,
                settings,
            );
            const load = commands.find((command) => command.method === 'load');
            if (!load) throw new Error('Expected load');
            const poll = session.poll();
            await session.configure({ ...settings, ...change });
            pendingSnapshot.resolve(snapshot(load.params.track));
            expect(await poll).toBeUndefined();
        },
    );

    it('rejects stale instances and queue revisions', async () => {
        const { pendingSnapshot, session } = fixture();
        await session.load(
            { duration: 100, gainDb: 0 },
            async () => 'https://music/audio',
            0,
            false,
            settings,
        );
        const poll = session.poll();
        pendingSnapshot.resolve(snapshot({ instanceId: 'previous-session', queueRevision: 99 }));
        expect(await poll).toBeUndefined();
    });

    it('does not resurrect a player disposed while its URL is pending', async () => {
        const { commands, session } = fixture();
        const url = deferred<string>();
        const loading = session.load(
            { duration: 100, gainDb: 0 },
            () => url.promise,
            0,
            false,
            settings,
        );
        await session.dispose();
        url.resolve('https://music/audio');
        await loading;
        expect(commands).toEqual([{ method: 'stop' }]);
    });
});
