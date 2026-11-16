import { expect, it } from 'vitest';

import { audioFixture, testAudioSettings, testBackend, waitForAudio } from './audio-test-fixture';

it('follows each decoded song rate in automatic exclusive mode without reopening its HTTP stream', async () => {
    const client = await testBackend();
    try {
        await client.request('configure', { ...testAudioSettings, exclusive: true });
        expect((await client.request('snapshot')).snapshot.sampleRate).toBe(0);
        for (const rate of [44100, 48000, 96000, 44100]) {
            const fixture = await audioFixture(0, rate);
            try {
                await client.request('load', {
                    paused: true,
                    settings: { ...testAudioSettings, exclusive: true },
                    start: 2,
                    track: {
                        duration: 8,
                        gainDb: 0,
                        instanceId: `source-${rate}`,
                        queueRevision: rate,
                        url: fixture.url,
                    },
                });
                const state = await waitForAudio(client, (state) => !state.buffering);
                expect(state.sampleRate).toBe(rate);
                expect(state.position).toBe(2);
                expect(state.paused).toBe(true);
                expect(fixture.requests.filter((range) => range === undefined)).toHaveLength(1);
                await client.request('seek', { position: 4 });
                await waitForAudio(client, (state) => !state.buffering && state.position === 4);
                await client.request('setPaused', { paused: false });
                await waitForAudio(client, (state) => state.position > 4.05);
            } finally {
                await fixture.close();
            }
        }
    } finally {
        await client.stop();
    }
}, 30000);

it('honors a forced exclusive rate and returns to the actual stream rate when cleared', async () => {
    const fixture = await audioFixture(200, 44100);
    const client = await testBackend();
    try {
        await client.request('load', {
            paused: false,
            settings: { ...testAudioSettings, exclusive: true },
            start: 0,
            track: {
                duration: 8,
                gainDb: 0,
                instanceId: 'source-controls',
                queueRevision: 1,
                url: fixture.url,
            },
        });
        await client.request('seek', { position: 2 });
        await client.request('setPaused', { paused: true });
        let state = await waitForAudio(client, (state) => !state.buffering);
        expect(state.sampleRate).toBe(44100);
        expect(state.position).toBe(2);
        expect(state.paused).toBe(true);
        await client.request('configure', {
            ...testAudioSettings,
            exclusive: true,
            sampleRate: 48000,
        });
        state = await waitForAudio(client, (state) => !state.buffering);
        expect(state.sampleRate).toBe(48000);
        await client.request('configure', { ...testAudioSettings, exclusive: true });
        state = await waitForAudio(client, (state) => !state.buffering);
        expect(state.sampleRate).toBe(44100);
        expect(state.instanceId).toBe('source-controls');
        expect(state.position).toBe(2);
        expect(state.paused).toBe(true);
    } finally {
        await client.stop();
        await fixture.close();
    }
}, 30000);

it('keeps negotiated exclusive output alive when changing volume after an unsupported requested rate', async () => {
    const fixture = await audioFixture();
    const client = await testBackend();
    const settings = { ...testAudioSettings, exclusive: true, sampleRate: 12345 };
    try {
        await client.request('load', {
            paused: false,
            settings,
            start: 0,
            track: {
                duration: 8,
                gainDb: 0,
                instanceId: 'negotiated-rate',
                queueRevision: 1,
                url: fixture.url,
            },
        });
        const before = await waitForAudio(
            client,
            (state) => !state.buffering && state.position > 0.1,
        );
        expect(before.sampleRate).not.toBe(12345);
        const requests = fixture.requests.length;
        await client.request('configure', { ...settings, volume: 20 });
        const after = await waitForAudio(client, (state) => state.position > before.position + 0.1);
        expect(after.sampleRate).toBe(before.sampleRate);
        expect(fixture.requests).toHaveLength(requests);
    } finally {
        await client.stop();
        await fixture.close();
    }
}, 30000);
