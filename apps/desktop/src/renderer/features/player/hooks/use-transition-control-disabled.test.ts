import { describe, expect, it, vi } from 'vitest';

import { transitionControlDisabled } from './use-transition-control-disabled';

import { PlayerStatus, PlayerStyle, PlayerType } from '/@/shared/types/types';

vi.mock('is-electron', () => ({ default: () => false }));
vi.mock('/@/renderer/features/radio/hooks/use-radio-player', () => ({
    useIsRadioActive: () => false,
}));
vi.mock('/@/renderer/store', () => ({
    useIsRadioActive: () => false,
    usePlaybackType: () => PlayerType.WEB,
    usePlayerProperties: () => ({ transitionType: PlayerStyle.GAPLESS }),
    usePlayerStatus: () => PlayerStatus.PLAYING,
}));

const base = {
    nativeActive: true,
    playbackType: PlayerType.WEB,
    status: PlayerStatus.PLAYING,
    transitionType: PlayerStyle.GAPLESS,
};

describe('transitionControlDisabled', () => {
    it('keeps the style switch editable mid-song on the native engine', () => {
        expect(transitionControlDisabled({ ...base, kind: 'type' })).toBe(false);
    });

    it('gates crossfade style and duration on crossfade being selected', () => {
        expect(transitionControlDisabled({ ...base, kind: 'style' })).toBe(true);
        expect(transitionControlDisabled({ ...base, kind: 'duration' })).toBe(true);
        const crossfade = { ...base, transitionType: PlayerStyle.CROSSFADE };
        expect(transitionControlDisabled({ ...crossfade, kind: 'style' })).toBe(false);
        expect(transitionControlDisabled({ ...crossfade, kind: 'duration' })).toBe(false);
    });

    it('keeps native controls editable while paused too', () => {
        const paused = { ...base, status: PlayerStatus.PAUSED };
        expect(transitionControlDisabled({ ...paused, kind: 'type' })).toBe(false);
    });

    it('gates crossfade-only controls when playback style is none', () => {
        const none = { ...base, transitionType: PlayerStyle.NONE };
        expect(transitionControlDisabled({ ...none, kind: 'type' })).toBe(false);
        expect(transitionControlDisabled({ ...none, kind: 'style' })).toBe(true);
        expect(transitionControlDisabled({ ...none, kind: 'duration' })).toBe(true);
    });

    it('preserves upstream gating for the web player while playing', () => {
        const web = { ...base, nativeActive: false, transitionType: PlayerStyle.CROSSFADE };
        expect(transitionControlDisabled({ ...web, kind: 'type' })).toBe(true);
        expect(transitionControlDisabled({ ...web, kind: 'style' })).toBe(true);
    });

    it('preserves upstream gating for the web player while paused', () => {
        const web = {
            ...base,
            nativeActive: false,
            status: PlayerStatus.PAUSED,
            transitionType: PlayerStyle.CROSSFADE,
        };
        expect(transitionControlDisabled({ ...web, kind: 'type' })).toBe(false);
        expect(transitionControlDisabled({ ...web, kind: 'duration' })).toBe(false);
    });

    it('locks non-web backends without the native engine', () => {
        const dlna = {
            ...base,
            nativeActive: false,
            playbackType: PlayerType.DLNA,
            status: PlayerStatus.PAUSED,
            transitionType: PlayerStyle.CROSSFADE,
        };
        expect(transitionControlDisabled({ ...dlna, kind: 'type' })).toBe(true);
        expect(transitionControlDisabled({ ...dlna, kind: 'style' })).toBe(true);
    });
});
