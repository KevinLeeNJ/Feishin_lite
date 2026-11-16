import type { HostBridge } from '/@/shared/backend/protocol';

import { ipcRenderer } from 'electron';

import { AUDIO_CHANNEL, BACKEND_CHANNEL } from '/@/shared/backend/constants';

export const hostBridge: HostBridge = {
    audio: {
        command: (command) => ipcRenderer.invoke(AUDIO_CHANNEL, command),
        snapshot: () => ipcRenderer.invoke(AUDIO_CHANNEL, { method: 'snapshot' }),
    },
    backend: {
        health: () => ipcRenderer.invoke(BACKEND_CHANNEL, 'health'),
        listOutputDevices: () => ipcRenderer.invoke(BACKEND_CHANNEL, 'listOutputDevices'),
    },
};
