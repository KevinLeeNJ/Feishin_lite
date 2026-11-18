import { expect, it } from 'vitest';

import {
    audioFixture,
    testAudioSettings,
    testBackend,
    waitForAudio,
    waitForCommit,
} from './audio-test-fixture';

import { AudioSettings } from '/@/shared/backend/audio';

const crossfade: AudioSettings = {
    ...testAudioSettings,
    transition: { crossfadeDuration: 2, crossfadeStyle: 'equalPower', mode: 'crossfade' },
};

async function loadCurrent(client: Awaited<ReturnType<typeof testBackend>>, url: string) {
    await client.request('load', {
        paused: false,
        settings: crossfade,
        start: 0,
        track: { duration: 8, gainDb: 0, instanceId: 'playback-test', queueRevision: 1, url },
    });
    await waitForAudio(client, (state) => !state.buffering);
}

const nextTrack = (url: string) => ({
    duration: 8,
    gainDb: 0,
    instanceId: 'next-test',
    queueRevision: 1,
    url,
});

it('crossfades into a prefetched next track that starts before the boundary', async () => {
    const fixture = await audioFixture();
    const client = await testBackend();
    try {
        await loadCurrent(client, fixture.url);
        await client.request('prepareNext', { track: nextTrack(`${fixture.url}?next`) });
        const { committed, last, sawEnded } = await waitForCommit(client, 'next-test');
        expect(sawEnded).toBe(false);
        expect(last.instanceId).toBe('playback-test');
        expect(last.position).toBeGreaterThan(7.5);
        // The next track already played through the 2s overlap before committing.
        expect(committed.position).toBeGreaterThan(1.5);
        expect(committed.position).toBeLessThan(3);
        const later = await waitForAudio(
            client,
            (state) => state.instanceId === 'next-test' && state.position > 2.5,
        );
        expect(later.underruns).toBe(0);
    } finally {
        await client.stop();
        await fixture.close();
    }
}, 30000);

it('aborts an armed crossfade when the prepared next track is cancelled', async () => {
    const fixture = await audioFixture();
    const client = await testBackend();
    try {
        await loadCurrent(client, fixture.url);
        await client.request('prepareNext', { track: nextTrack(`${fixture.url}?next`) });
        await waitForAudio(client, (state) => state.position > 6.5);
        await client.request('prepareNext', { track: null });
        const ended = await waitForAudio(
            client,
            (state) => state.ended && state.instanceId === 'playback-test',
        );
        expect(ended.instanceId).toBe('playback-test');
    } finally {
        await client.stop();
        await fixture.close();
    }
}, 30000);
