import { ipcMain } from 'electron';

import { store } from '../settings';

import { isClientPlayback } from '/@/shared/backend/playback-target';
import { PlayerType } from '/@/shared/types/types';

let isLocalVisualizerSurfaceVisible = false;

export const setLocalVisualizerSurfaceVisible = (visible: boolean) => {
    isLocalVisualizerSurfaceVisible = visible;
};

export const canHandleVisualizerDisplayMedia = (): boolean => {
    const playbackType = store.get('playbackType', PlayerType.WEB) as PlayerType;

    if (!isClientPlayback(playbackType)) {
        return false;
    }

    return isLocalVisualizerSurfaceVisible;
};

ipcMain.on('visualizer-set-local-surface-visible', (_event, visible: boolean) => {
    setLocalVisualizerSurfaceVisible(Boolean(visible));
});
