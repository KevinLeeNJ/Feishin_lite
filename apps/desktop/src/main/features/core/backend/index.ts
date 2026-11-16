import { app, ipcMain, IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

import { BackendClient } from './client';
import { backendExecutablePath } from './executable';

import log from '/@/main/logger';
import { audioCommandSchema } from '/@/shared/backend/audio';
import { AUDIO_CHANNEL, BACKEND_CHANNEL } from '/@/shared/backend/constants';

let backend: Promise<BackendClient> | undefined;
let quitting = false;

function assertTrustedSender(event: IpcMainInvokeEvent): void {
    if (event.senderFrame !== event.sender.mainFrame) {
        throw new Error('Backend access requires the main frame');
    }
    const expected = new URL(
        (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) ||
            pathToFileURL(join(__dirname, '../renderer/index.html')).href,
    );
    const source = new URL(event.senderFrame.url);
    if (source.origin !== expected.origin || source.pathname !== expected.pathname) {
        throw new Error('Untrusted backend caller');
    }
}

async function getBackend(): Promise<BackendClient> {
    if (quitting) {
        return Promise.reject(new Error('Application is quitting'));
    }
    if (backend) {
        const observed = backend;
        const client = await observed;
        if (client.isRunning) {
            return client;
        }
        if (backend === observed) {
            backend = undefined;
        }
        return getBackend();
    }
    if (!backend) {
        const executable = backendExecutablePath(
            app.isPackaged
                ? join(process.resourcesPath, 'backend')
                : join(app.getAppPath(), '../../target/debug'),
        );
        backend = BackendClient.start(executable, () =>
            log.warn('Rust backend emitted native diagnostics'),
        ).catch((error: unknown) => {
            backend = undefined;
            log.error('Rust backend startup failed', error);
            throw error;
        });
    }
    return backend;
}

ipcMain.handle(BACKEND_CHANNEL, async (event, input: unknown) => {
    assertTrustedSender(event);
    const method = z.enum(['health', 'listOutputDevices']).parse(input);
    try {
        const client = await getBackend();
        return await client.request(method);
    } catch (error) {
        log.error('Rust backend inspection failed', { error, method });
        throw error;
    }
});

ipcMain.handle(AUDIO_CHANNEL, async (event, input: unknown) => {
    assertTrustedSender(event);
    const command = audioCommandSchema.parse(input);
    try {
        const client = await getBackend();
        const result = await client.request(
            command.method,
            'params' in command ? command.params : undefined,
        );
        if ('snapshot' in result) {
            return result.snapshot;
        }
        return undefined;
    } catch (error) {
        log.error('Rust audio command failed', { method: command.method });
        throw error;
    }
});

app.on('before-quit', (event) => {
    if (!backend || quitting) {
        return;
    }
    event.preventDefault();
    quitting = true;
    void backend
        .then((client) => client.stop())
        .catch(() => log.warn('Rust backend did not shut down cleanly'))
        .finally(() => app.quit());
});
