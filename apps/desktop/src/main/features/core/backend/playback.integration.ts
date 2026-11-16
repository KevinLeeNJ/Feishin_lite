import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';

import { BackendClient } from './client';
import { backendExecutablePath } from './executable';

import { AudioSettings, AudioSnapshot } from '/@/shared/backend/audio';

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
    muted: true,
    preservePitch: true,
    speed: 1,
    volume: 0,
};

async function waitFor(
    client: BackendClient,
    condition: (state: AudioSnapshot) => boolean,
): Promise<AudioSnapshot> {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
        const { snapshot } = await client.request('snapshot');
        if (snapshot.error) {
            throw new Error(snapshot.error);
        }
        if (condition(snapshot)) {
            return snapshot;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('Audio playback condition timed out');
}

function wave(): Buffer {
    const rate = 44100;
    const frames = rate * 8;
    const bytes = Buffer.alloc(44 + frames * 4);
    bytes.write('RIFF', 0);
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(2, 22);
    bytes.writeUInt32LE(rate, 24);
    bytes.writeUInt32LE(rate * 4, 28);
    bytes.writeUInt16LE(4, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36);
    bytes.writeUInt32LE(frames * 4, 40);
    for (let index = 0; index < frames; index++) {
        const sample = Math.round(Math.sin((index * 440 * Math.PI * 2) / rate) * 3000);
        bytes.writeInt16LE(sample, 44 + index * 4);
        bytes.writeInt16LE(sample, 46 + index * 4);
    }
    return bytes;
}

it('streams HTTP audio through decode/resample/CPAL and controls pause, seek and speed without sound', async () => {
    const bytes = wave();
    const server = createServer((request, response) => {
        const match = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
        const start = match ? Number(match[1]) : 0;
        const end = match?.[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
        response.writeHead(match ? 206 : 200, {
            'accept-ranges': 'bytes',
            'content-length': end - start + 1,
            'content-type': 'audio/wav',
            ...(match ? { 'content-range': `bytes ${start}-${end}/${bytes.length}` } : {}),
        });
        response.end(bytes.subarray(start, end + 1));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('No test HTTP port');
    }
    const binary = backendExecutablePath(
        fileURLToPath(new URL('../../../../../../../target/debug/', import.meta.url)),
    );
    const client = await BackendClient.start(binary, vi.fn());
    try {
        await client.request('load', {
            paused: true,
            settings,
            start: 0,
            track: {
                duration: 8,
                gainDb: 0,
                instanceId: 'playback-test',
                queueRevision: 1,
                url: `http://127.0.0.1:${address.port}/audio.wav`,
            },
        });
        await waitFor(client, (state) => !state.buffering);
        expect((await client.request('snapshot')).snapshot.position).toBe(0);
        await client.request('setPaused', { paused: false });
        expect(
            (await waitFor(client, (state) => state.position > 0.15)).sampleRate,
        ).toBeGreaterThan(0);
        await client.request('setPaused', { paused: true });
        const frozen = (await client.request('snapshot')).snapshot.position;
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect((await client.request('snapshot')).snapshot.position).toBeCloseTo(frozen, 2);
        await client.request('seek', { position: 6 });
        await waitFor(client, (state) => state.paused && state.position >= 5.95);
        await client.request('configure', { ...settings, speed: 2 });
        await client.request('setPaused', { paused: false });
        await waitFor(client, (state) => state.position > 6.2);
        await client.request('stop');
        expect((await client.request('snapshot')).snapshot.instanceId).toBeNull();
    } finally {
        await client.stop();
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
        );
    }
}, 30000);
