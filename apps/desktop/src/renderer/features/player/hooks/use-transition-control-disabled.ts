import isElectron from 'is-electron';

import { useIsRadioActive } from '/@/renderer/features/radio/hooks/use-radio-player';
import { usePlaybackType, usePlayerProperties, usePlayerStatus } from '/@/renderer/store';
import { PlayerStatus, PlayerStyle, PlayerType } from '/@/shared/types/types';

export type TransitionControlKind = 'duration' | 'style' | 'type';

/**
 * The web player rebuilds its audio graph on transition changes, so upstream locks the
 * controls while playing and outside the web backend. The Rust engine applies transition
 * settings live through configure, so desktop native playback keeps them editable mid-song;
 * radio and DLNA still fall back to the upstream gating.
 */
export const transitionControlDisabled = (args: {
    kind: TransitionControlKind;
    nativeActive: boolean;
    playbackType: PlayerType;
    status: PlayerStatus;
    transitionType: PlayerStyle;
}): boolean => {
    const crossfadeOnly = args.kind !== 'type' && args.transitionType !== PlayerStyle.CROSSFADE;
    if (args.nativeActive) {
        return crossfadeOnly;
    }
    return (
        crossfadeOnly ||
        args.playbackType !== PlayerType.WEB ||
        args.status === PlayerStatus.PLAYING
    );
};

export const useTransitionControlDisabled = (kind: TransitionControlKind): boolean => {
    const playbackType = usePlaybackType();
    const status = usePlayerStatus();
    const { transitionType } = usePlayerProperties();
    const radioActive = useIsRadioActive();
    const nativeActive =
        isElectron() &&
        !radioActive &&
        (playbackType === PlayerType.LOCAL || playbackType === PlayerType.WEB);
    return transitionControlDisabled({ kind, nativeActive, playbackType, status, transitionType });
};
