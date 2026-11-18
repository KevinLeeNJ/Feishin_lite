import { expect, it } from 'vitest';

import {
    audioFixture,
    loadTestAudio,
    testBackend,
    waitForAudio,
    waitForCommit,
} from './audio-test-fixture';

const nextTrack = (url: string) => ({
    duration: 8,
    gainDb: 0,
    instanceId: 'next-test',
    queueRevision: 1,
    url,
});

it('rejects prepareNext before any track is loaded', async () => {
    const client = await testBackend();
    try {
        await expect(client.request('prepareNext', { track: null })).rejects.toThrow();
    } finally {
        await client.stop();
    }
});

it('commits a prefetched next track gaplessly at the audible boundary', async () => {
    const fixture = await audioFixture();
    const client = await testBackend();
    try {
        await loadTestAudio(client, fixture.url);
        await client.request('prepareNext', { track: nextTrack(`${fixture.url}?next`) });
        const { committed, last, sawEnded } = await waitForCommit(client, 'next-test');
        expect(sawEnded).toBe(false);
        expect(last.instanceId).toBe('playback-test');
        expect(last.position).toBeGreaterThan(7.5);
        expect(committed.queueRevision).toBe(1);
        expect(committed.position).toBeLessThan(0.5);
        expect(committed.duration).toBeCloseTo(8, 1);
        const later = await waitForAudio(
            client,
            (state) => state.instanceId === 'next-test' && state.position > 0.3,
        );
        expect(later.underruns).toBe(0);
        await client.request('stop');
        expect((await client.request('snapshot')).snapshot.instanceId).toBeNull();
    } finally {
        await client.stop();
        await fixture.close();
    }
}, 30000);

it('falls back to ended when the prepared next track is cancelled', async () => {
    const fixture = await audioFixture();
    const client = await testBackend();
    try {
        await loadTestAudio(client, fixture.url);
        await client.request('prepareNext', { track: nextTrack(`${fixture.url}?next`) });
        await waitForAudio(client, (state) => state.position > 2);
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
