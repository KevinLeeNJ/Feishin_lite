import { z } from 'zod';

import { AudioCommand, AudioSnapshot, audioSnapshotSchema } from './audio';
import { BACKEND_PROTOCOL_VERSION } from './constants';

export const backendMethodSchema = z.enum([
    'hello',
    'health',
    'listOutputDevices',
    'shutdown',
    'load',
    'configure',
    'seek',
    'setPaused',
    'stop',
    'snapshot',
]);
export type BackendMethod = z.infer<typeof backendMethodSchema>;

export const outputDeviceSchema = z
    .object({ id: z.string().min(1), isDefault: z.boolean(), name: z.string() })
    .strict();

export const backendResultSchema = z.discriminatedUnion('method', [
    z
        .object({
            capabilities: z.array(z.enum(['health', 'listOutputDevices', 'audio'])),
            method: z.literal('hello'),
        })
        .strict(),
    z.object({ method: z.literal('health'), uptimeMs: z.number().int().nonnegative() }).strict(),
    z
        .object({ devices: z.array(outputDeviceSchema), method: z.literal('listOutputDevices') })
        .strict(),
    z.object({ method: z.literal('shutdown') }).strict(),
    z.object({ method: z.literal('load') }).strict(),
    z.object({ method: z.literal('configure') }).strict(),
    z.object({ method: z.literal('seek') }).strict(),
    z.object({ method: z.literal('setPaused') }).strict(),
    z.object({ method: z.literal('stop') }).strict(),
    z.object({ method: z.literal('snapshot'), snapshot: audioSnapshotSchema }).strict(),
]);

const envelope = {
    protocolVersion: z.literal(BACKEND_PROTOCOL_VERSION),
    requestId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(128),
};

export const backendResponseSchema = z.union([
    z.object({ ...envelope, result: backendResultSchema }).strict(),
    z
        .object({
            ...envelope,
            error: z.object({ code: z.string(), message: z.string() }).strict(),
        })
        .strict(),
]);

export type BackendResult = z.infer<typeof backendResultSchema>;
// This contract contains no Electron or Node types. M3 can provide the same methods.
export interface HostBridge {
    audio: {
        command(command: AudioCommand): Promise<void>;
        snapshot(): Promise<AudioSnapshot>;
    };
    backend: {
        health(): Promise<Extract<BackendResult, { method: 'health' }>>;
        listOutputDevices(): Promise<Extract<BackendResult, { method: 'listOutputDevices' }>>;
    };
}

export type OutputDevice = z.infer<typeof outputDeviceSchema>;
