import { expect, it } from 'vitest';

import { RustPlaybackSession } from '../../../../renderer/features/player/audio-player/rust-playback-session';
import { audioFixture, testAudioSettings, testBackend, waitForAudio } from './audio-test-fixture';

it('restarts a stopped one-song session without repeating slow HTTP setup', async () => {
    const fixture = await audioFixture(600);
    const client = await testBackend();
    const session = new RustPlaybackSession({
        command: async (command) => {
            await client.request(command.method, 'params' in command ? command.params : undefined);
        },
        snapshot: async () => (await client.request('snapshot')).snapshot,
    });
    try {
        await session.load(
            { duration: 8, gainDb: 0 },
            async () => fixture.url,
            0,
            false,
            testAudioSettings,
        );
        const original = await waitForAudio(client, (state) => state.position > 0.15);
        const requests = fixture.requests.length;
        for (let repeat = 0; repeat < 3; repeat++) {
            await session.seek(0);
            await session.pause(true);
            await waitForAudio(client, (state) => state.paused && !state.buffering);
            const start = performance.now();
            await session.restart(0, false);
            const restarted = await waitForAudio(
                client,
                (state) => !state.buffering && !state.paused && state.position > 0.02,
            );
            expect(performance.now() - start).toBeLessThan(250);
            expect(restarted.position).toBeLessThan(0.5);
            expect(restarted.instanceId).toBe(original.instanceId);
            expect(restarted.queueRevision).toBe(original.queueRevision);
            expect(fixture.requests).toHaveLength(requests);
        }
    } finally {
        await session.dispose();
        await client.stop();
        await fixture.close();
    }
}, 20000);
