import { describe, expect, it } from 'vitest';

import { backendResponseSchema } from './protocol';

describe('backend response contract', () => {
    const response = {
        protocolVersion: 1,
        requestId: 'request',
        result: { method: 'health', uptimeMs: 1 },
        sessionId: 'session',
    };

    it('requires a single result or error with the supported protocol version', () => {
        expect(backendResponseSchema.safeParse(response).success).toBe(true);
        for (const invalid of [
            { ...response, protocolVersion: 2 },
            { ...response, sessionId: '' },
            { ...response, error: { code: 'ERROR', message: 'error' } },
            { ...response, result: { method: 'health', uptimeMs: -1 } },
            { ...response, result: { method: 'play' } },
        ]) {
            expect(backendResponseSchema.safeParse(invalid).success).toBe(false);
        }
    });
});
