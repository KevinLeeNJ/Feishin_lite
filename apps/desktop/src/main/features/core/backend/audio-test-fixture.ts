import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { BackendClient } from './client';
import { backendExecutablePath } from './executable';

import { AudioSettings, AudioSnapshot } from '/@/shared/backend/audio';

export const testAudioSettings: AudioSettings = {
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

export async function audioFixture(headerDelayMs = 0, rate = 44100) {
    const bytes = testWave(rate);
    const requests: (string | undefined)[] = [];
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const server = createServer((request, response) => {
        requests.push(request.headers.range);
        const timer = setTimeout(() => {
            timers.delete(timer);
            const match = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
            const start = match ? Number(match[1]) : 0;
            const end = match?.[2]
                ? Math.min(Number(match[2]), bytes.length - 1)
                : bytes.length - 1;
            response.writeHead(match ? 206 : 200, {
                'accept-ranges': 'bytes',
                'content-length': end - start + 1,
                'content-type': 'audio/wav',
                ...(match ? { 'content-range': `bytes ${start}-${end}/${bytes.length}` } : {}),
            });
            response.end(bytes.subarray(start, end + 1));
        }, headerDelayMs);
        timers.add(timer);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('No test HTTP port');
    }
    return {
        close: async () => {
            for (const timer of timers) {
                clearTimeout(timer);
            }
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve())),
            );
        },
        requests,
        url: `http://127.0.0.1:${address.port}/audio.wav`,
    };
}

export async function loadTestAudio(
    client: BackendClient,
    url: string,
    paused = false,
): Promise<void> {
    await client.request('load', {
        paused,
        settings: testAudioSettings,
        start: 0,
        track: { duration: 8, gainDb: 0, instanceId: 'playback-test', queueRevision: 1, url },
    });
    await waitForAudio(client, (state) => !state.buffering);
}

export function testBackend(): Promise<BackendClient> {
    const binary = backendExecutablePath(
        fileURLToPath(new URL('../../../../../../../target/debug/', import.meta.url)),
    );
    return BackendClient.start(binary, () => {});
}

export function testWave(rate = 44100): Buffer {
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

export async function waitForAudio(
    client: BackendClient,
    condition: (state: AudioSnapshot) => boolean,
): Promise<AudioSnapshot> {
    const deadline = Date.now() + 8000;
    let last: AudioSnapshot | undefined;
    while (Date.now() < deadline) {
        const { snapshot } = await client.request('snapshot');
        last = snapshot;
        if (snapshot.error) {
            throw new Error(snapshot.error);
        }
        if (condition(snapshot)) {
            return snapshot;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Audio playback condition timed out: ${JSON.stringify(last)}`);
}
