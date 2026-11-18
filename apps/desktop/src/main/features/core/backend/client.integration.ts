import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';

import { BackendClient } from './client';
import { backendExecutablePath } from './executable';

it('uses the real Rust sidecar for handshake, health, device enumeration and shutdown', async () => {
    const executable = backendExecutablePath(
        fileURLToPath(new URL('../../../../../../../target/debug/', import.meta.url)),
    );
    const diagnostic = vi.fn();
    const client = await BackendClient.start(executable, diagnostic);
    try {
        const [health, devices, visualizer] = await Promise.all([
            client.request('health'),
            client.request('listOutputDevices'),
            client.request('visualizerSamples'),
        ]);
        expect(health.uptimeMs).toBeGreaterThanOrEqual(0);
        expect(devices.devices.every((device) => device.id.length > 0)).toBe(true);
        expect(visualizer.samples).toBeNull();
        expect(diagnostic).not.toHaveBeenCalled();
    } finally {
        await client.stop();
    }
}, 15000);
