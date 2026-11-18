import isElectron from 'is-electron';

import { supportsSilentAudioContext } from '/@/renderer/features/visualizer/native-visualizer-input';
import { useNativeVisualizerFailed } from '/@/renderer/features/visualizer/native-visualizer-status';
import { useMpvSettings, usePlaybackType } from '/@/renderer/store';
import { isClientPlayback } from '/@/shared/backend/playback-target';

export function useVisualizerExclusiveBlocked(): boolean {
    const exclusive = useVisualizerExclusiveMode();
    const failed = useNativeVisualizerFailed();
    return (
        exclusive && (failed || !window.api?.utils?.isWindows?.() || !supportsSilentAudioContext())
    );
}

export function useVisualizerExclusiveMode(): boolean {
    const { audioExclusiveMode } = useMpvSettings();
    const playbackType = usePlaybackType();
    return isElectron() && isClientPlayback(playbackType) && audioExclusiveMode === 'yes';
}
