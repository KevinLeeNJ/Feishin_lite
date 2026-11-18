import { expect, it } from 'vitest';

import { audioFixture, testAudioSettings, testBackend, waitForAudio } from './audio-test-fixture';

import { AudioSettings } from '/@/shared/backend/audio';

const none: AudioSettings = {
    ...testAudioSettings,
    transition: { crossfadeDuration: 5, crossfadeStyle: 'equalPower', mode: 'none' },
};

it('plays to the natural end without committing a prepared next track', async () => {
    const fixture = await audioFixture();
    const client = await testBackend();
    try {
        await client.request('load', {
            paused: false,
            settings: none,
            start: 0,
            track: {
                duration: 8,
                gainDb: 0,
                instanceId: 'playback-test',
                queueRevision: 1,
                url: fixture.url,
            },
        });
        await waitForAudio(client, (state) => !state.buffering);
        await client.request('prepareNext', {
            track: {
                duration: 8,
                gainDb: 0,
                instanceId: 'next-test',
                queueRevision: 1,
                url: `${fixture.url}?next`,
            },
        });
        const ended = await waitForAudio(
            client,
            (state) => state.ended && state.instanceId === 'playback-test',
        );
        expect(ended.position).toBeGreaterThanOrEqual(7.9);
        const { snapshot } = await client.request('snapshot');
        expect(snapshot.instanceId).toBe('playback-test');
        expect(snapshot.ended).toBe(true);
    } finally {
        await client.stop();
        await fixture.close();
    }
}, 30000);
