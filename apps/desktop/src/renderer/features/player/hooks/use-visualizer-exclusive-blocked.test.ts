// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { useVisualizerExclusiveBlocked } from './use-visualizer-exclusive-blocked';

import { setNativeVisualizerFailed } from '/@/renderer/features/visualizer/native-visualizer-status';
import { PlayerType } from '/@/shared/types/types';

const settings = vi.hoisted(() => ({ audioExclusiveMode: 'yes' }));
vi.mock('is-electron', () => ({ default: () => true }));
vi.mock('/@/renderer/store', () => ({
    useMpvSettings: () => settings,
    usePlaybackType: () => PlayerType.LOCAL,
}));

afterEach(() => {
    cleanup();
    setNativeVisualizerFailed(false);
    settings.audioExclusiveMode = 'yes';
    vi.unstubAllGlobals();
});

it('disables the exclusive visualizer only when its silent input is unavailable', () => {
    vi.stubGlobal('api', { utils: { isWindows: () => true } });
    vi.stubGlobal('AudioContext', undefined);
    const { rerender, result } = renderHook(useVisualizerExclusiveBlocked);
    expect(result.current).toBe(true);

    class SilentContext {
        get sinkId() {
            return { type: 'none' };
        }
    }
    vi.stubGlobal('AudioContext', SilentContext);
    rerender();
    expect(result.current).toBe(false);

    act(() => setNativeVisualizerFailed(true));
    expect(result.current).toBe(true);

    settings.audioExclusiveMode = 'no';
    rerender();
    expect(result.current).toBe(false);
});
