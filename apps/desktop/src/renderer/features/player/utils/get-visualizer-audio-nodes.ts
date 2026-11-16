import type { WebAudio } from '/@/shared/types/types';

import isElectron from 'is-electron';

import { isClientPlayback } from '/@/shared/backend/playback-target';
import { PlayerType } from '/@/shared/types/types';

export function getVisualizerAudioNodes(
    webAudio: undefined | WebAudio,
    playbackType: PlayerType,
): AudioNode[] {
    if (!webAudio) return [];
    if (isElectron() && isClientPlayback(playbackType)) {
        return webAudio.visualizerInputs ?? [];
    }
    return webAudio.gains;
}
