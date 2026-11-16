import { expect, it } from 'vitest';

import { audioFixture, loadTestAudio, testBackend, waitForAudio } from './audio-test-fixture';

it('seeks cached audio in the current session without repeating a slow HTTP connection', async () => {
    const fixture = await audioFixture(400);
    const client = await testBackend();
    try {
        await loadTestAudio(client, fixture.url);
        const original = await waitForAudio(client, (state) => state.position > 0.15);
        const requests = fixture.requests.length;
        const started = performance.now();
        await client.request('seek', { position: 6 });
        const result = await waitForAudio(
            client,
            (state) => !state.buffering && state.position > 6.02,
        );
        expect(fixture.requests).toHaveLength(requests);
        expect(performance.now() - started).toBeLessThan(250);
        expect(result.instanceId).toBe(original.instanceId);
        expect(result.queueRevision).toBe(original.queueRevision);
        expect(result.paused).toBe(false);
    } finally {
        await client.stop();
        await fixture.close();
    }
}, 20000);

it('keeps pause state across repeated seeks and can seek after the decoder reaches EOF', async () => {
    const fixture = await audioFixture();
    const client = await testBackend();
    try {
        await loadTestAudio(client, fixture.url, true);
        const fullRequests = fixture.requests.filter((range) => range === undefined).length;
        await Promise.all([2, 7, 0, 3].map((position) => client.request('seek', { position })));
        const paused = await waitForAudio(
            client,
            (state) => !state.buffering && state.paused && Math.abs(state.position - 3) < 0.01,
        );
        await new Promise((resolve) => setTimeout(resolve, 80));
        expect((await client.request('snapshot')).snapshot.position).toBe(paused.position);
        await client.request('seek', { position: 7.96 });
        await client.request('setPaused', { paused: false });
        await waitForAudio(client, (state) => state.ended);
        await client.request('seek', { position: 0 });
        const restarted = await waitForAudio(
            client,
            (state) =>
                !state.buffering && !state.ended && state.position > 0.02 && state.position < 0.5,
        );
        expect(restarted.paused).toBe(false);
        expect(fixture.requests.filter((range) => range === undefined)).toHaveLength(fullRequests);
    } finally {
        await client.stop();
        await fixture.close();
    }
}, 20000);
