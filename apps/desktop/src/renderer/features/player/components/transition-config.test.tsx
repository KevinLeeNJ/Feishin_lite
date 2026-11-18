// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import {
    clearNativePlaybackClock,
    updateNativePlaybackClock,
} from '../audio-player/native-playback-clock';
import { TransitionTypeConfig } from './transition-config';

import { PlayerStyle, PlayerType } from '/@/shared/types/types';

const fixture = vi.hoisted(() => ({ setTransitionType: vi.fn() }));
vi.mock('is-electron', () => ({ default: () => true }));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: { context?: string }) => options?.context ?? key,
    }),
}));
vi.mock('/@/renderer/features/player/hooks/use-transition-control-disabled', () => ({
    useTransitionControlDisabled: () => false,
}));
vi.mock('/@/renderer/store', () => ({
    usePlaybackSettings: () => ({ mpvProperties: { audioExclusiveMode: 'yes' } }),
    usePlaybackType: () => PlayerType.LOCAL,
    usePlayerActions: () => ({ setTransitionType: fixture.setTransitionType }),
    usePlayerProperties: () => ({ transitionType: PlayerStyle.GAPLESS }),
}));
vi.mock('/@/shared/components/segmented-control/segmented-control', () => ({
    SegmentedControl: ({
        data,
    }: {
        data: { disabled?: boolean; label: string; value: string }[];
    }) => (
        <>
            {data.map(({ disabled, label, value }) => (
                <button disabled={disabled} key={value}>
                    {label}
                </button>
            ))}
        </>
    ),
}));
vi.mock('/@/shared/components/stack/stack', () => ({
    Stack: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('/@/shared/components/text/text', () => ({
    Text: ({ children }: React.PropsWithChildren) => <p>{children}</p>,
}));

afterEach(() => {
    cleanup();
    clearNativePlaybackClock();
});

it('greys out only the transitions when the native engine detects a different next rate', () => {
    render(<TransitionTypeConfig />);
    const gapless = screen.getByRole<HTMLButtonElement>('button', { name: 'optionNormal' });
    const crossfade = screen.getByRole<HTMLButtonElement>('button', { name: 'optionCrossFade' });
    const none = screen.getByRole<HTMLButtonElement>('button', { name: 'optionNone' });
    expect(gapless.disabled).toBe(false);

    act(() =>
        updateNativePlaybackClock(
            {
                buffering: false,
                duration: 100,
                ended: false,
                error: null,
                instanceId: 'track',
                outputLatencyMs: 10,
                paused: false,
                position: 20,
                queueRevision: 1,
                sampleRate: 48000,
                transitionRateMismatch: true,
                underruns: 0,
            },
            1,
        ),
    );
    expect(gapless.disabled).toBe(true);
    expect(crossfade.disabled).toBe(true);
    expect(none.disabled).toBe(false);
    expect(screen.getByText('setting.playbackStyleRateMismatch')).toBeTruthy();

    act(clearNativePlaybackClock);
    expect(gapless.disabled).toBe(false);
    expect(crossfade.disabled).toBe(false);
});
