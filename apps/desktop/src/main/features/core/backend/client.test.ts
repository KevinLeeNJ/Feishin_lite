import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackendClient } from './client';
import { BackendFrameDecoder, encodeBackendFrame } from './frame';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));

type Request = { method: string; requestId: string };

function createChild() {
    const child = Object.assign(new EventEmitter(), {
        kill: vi.fn(() => {
            queueMicrotask(() => child.emit('close', 0));
            return true;
        }),
        stderr: new PassThrough(),
        stdin: new PassThrough(),
        stdout: new PassThrough(),
    });
    return child;
}

function fakeBackend(
    handle?: (request: Request, child: ReturnType<typeof createChild>) => boolean,
) {
    const child = createChild();
    const decoder = new BackendFrameDecoder();
    child.stdin.on('data', (chunk: Buffer) =>
        decoder.push(chunk, (value) => {
            const request = value as Request;
            queueMicrotask(() => {
                if (handle?.(request, child)) {
                    return;
                }
                child.stdout.write(
                    encodeBackendFrame({
                        protocolVersion: 1,
                        requestId: request.requestId,
                        result:
                            request.method === 'hello'
                                ? { capabilities: ['health', 'listOutputDevices'], method: 'hello' }
                                : {
                                      method: request.method,
                                      ...(request.method === 'health' ? { uptimeMs: 1 } : {}),
                                  },
                        sessionId: 'session',
                    }),
                );
                if (request.method === 'shutdown') {
                    child.kill();
                }
            });
        }),
    );
    spawn.mockReturnValue(child);
    return child;
}

afterEach(() => vi.clearAllMocks());

describe('backend process lifecycle', () => {
    it('handshakes once, correlates concurrent requests, and shuts down', async () => {
        const child = fakeBackend();
        const client = await BackendClient.start('backend', vi.fn());
        const results = await Promise.all([client.request('health'), client.request('health')]);
        expect(results).toEqual([
            { method: 'health', uptimeMs: 1 },
            { method: 'health', uptimeMs: 1 },
        ]);
        await client.stop();
        expect(child.kill).toHaveBeenCalled();
        await expect(client.request('health')).rejects.toThrow();
    });

    it('rejects pending commands when the process exits', async () => {
        fakeBackend((request, child) => {
            if (request.method !== 'health') {
                return false;
            }
            child.kill();
            return true;
        });
        const client = await BackendClient.start('backend', vi.fn());
        await expect(client.request('health')).rejects.toThrow('closed');
        await client.stop();
    });

    it('kills an unresponsive backend after its request deadline', async () => {
        const child = fakeBackend((request) => request.method === 'health');
        const client = await BackendClient.start('backend', vi.fn(), 30);
        await expect(client.request('health')).rejects.toThrow('timed out');
        expect(child.kill).toHaveBeenCalled();
        await client.stop();
    });

    it('rejects stale sessions and malformed responses', async () => {
        for (const invalid of [
            {},
            {
                protocolVersion: 1,
                requestId: 'unknown',
                result: { method: 'health', uptimeMs: 1 },
                sessionId: 'stale',
            },
        ]) {
            fakeBackend((request, child) => {
                if (request.method !== 'health') {
                    return false;
                }
                child.stdout.write(encodeBackendFrame(invalid));
                return true;
            });
            const client = await BackendClient.start('backend', vi.fn());
            await expect(client.request('health')).rejects.toThrow('Invalid');
            await client.stop();
        }
    });

    it('cleans up spawn errors without leaving an unhandled pipe error', async () => {
        const child = fakeBackend(() => true);
        child.stdin = new Writable({
            write(_chunk, _encoding, callback) {
                callback(new Error('EPIPE'));
            },
        }) as PassThrough;
        await expect(BackendClient.start('missing', vi.fn())).rejects.toThrow('input closed');
        expect(child.kill).toHaveBeenCalled();
    });
});
