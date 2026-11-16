import { expect, it } from 'vitest';

import {
    audioFixture,
    loadTestAudio,
    testAudioSettings,
    testBackend,
    waitForAudio,
} from './audio-test-fixture';

it('changes shared output rates while retaining the current song and pause state', async () => {
    const fixture = await audioFixture();
    const client = await testBackend();
    try {
        await loadTestAudio(client, fixture.url, true);
        await client.request('seek', { position: 2 });
        for (const sampleRate of [44100, 96000, 48000]) {
            await client.request('configure', {
                ...testAudioSettings,
                exclusive: false,
                sampleRate,
            });
            const state = await waitForAudio(client, (state) => !state.buffering);
            expect(state.sampleRate).toBe(sampleRate);
            expect(state.paused).toBe(true);
            expect(state.position).toBeCloseTo(2, 2);
        }
        await client.request('setPaused', { paused: false });
        await waitForAudio(client, (state) => state.position > 2.1);
        await client.request('configure', { ...testAudioSettings, sampleRate: 44100 });
        const state = await waitForAudio(
            client,
            (state) => !state.buffering && state.position > 2.1,
        );
        expect(state.sampleRate).toBe(44100);
        expect(state.paused).toBe(false);
    } finally {
        await client.stop();
        await fixture.close();
    }
}, 30000);

it('acquires exclusive output, rejects another shared stream, and releases it when switching back', async () => {
    const fixture = await audioFixture();
    const first = await testBackend();
    const second = await testBackend();
    try {
        await loadTestAudio(first, fixture.url, true);
        await first.request('configure', {
            ...testAudioSettings,
            exclusive: true,
            sampleRate: 48000,
        });
        expect((await first.request('snapshot')).snapshot.sampleRate).toBe(48000);
        await first.request('setPaused', { paused: false });
        await waitForAudio(first, (state) => !state.buffering && state.position > 0.1);
        await expect(
            second.request('configure', { ...testAudioSettings, exclusive: false }),
        ).rejects.toThrow();
        await first.request('configure', { ...testAudioSettings, exclusive: false });
        await second.request('configure', { ...testAudioSettings, exclusive: false });
        await first.request('stop');
        await second.request('stop');
        await first.request('configure', {
            ...testAudioSettings,
            exclusive: true,
            sampleRate: 48000,
        });
        await first.request('stop');
        await second.request('configure', { ...testAudioSettings, exclusive: false });
    } finally {
        await first.stop();
        await second.stop();
        await fixture.close();
    }
}, 30000);
