// @vitest-environment jsdom
import type { LyricPlayerRef } from '@applemusic-like-lyrics/react';
import type { RefObject } from 'react';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAmllPlaybackClock } from './use-amll-playback-clock';

import {
    clearNativePlaybackClock,
    updateNativePlaybackClock,
} from '/@/renderer/features/player/audio-player/native-playback-clock';
import { AudioSnapshot } from '/@/shared/backend/audio';

vi.mock('/@/renderer/store', () => {
    const state = { player: { speed: 1, status: 'playing' } };
    const usePlayerStoreBase = (selector: (s: typeof state) => unknown) => selector(state);
    usePlayerStoreBase.getState = () => state;
    return {
        subscribePlayerSpeed: () => () => {},
        subscribePlayerStatus: () => () => {},
        usePlayerStoreBase,
    };
});

vi.mock('/@/renderer/store/timestamp.store', () => ({
    subscribePlayerProgress: () => () => {},
    useTimestampStoreBase: { getState: () => ({ timestamp: 10 }) },
}));

const snapshot: AudioSnapshot = {
    buffering: false,
    duration: 30,
    ended: false,
    error: null,
    instanceId: 'track',
    outputLatencyMs: 10,
    paused: false,
    position: 10,
    queueRevision: 1,
    sampleRate: 48000,
    underruns: 0,
};

const makePlayerRef = () => {
    const setCurrentTime = vi.fn();
    const ref = {
        current: {
            lyricPlayer: {
                getElement: () => ({ getAnimations: () => [] }),
                setCurrentTime,
            },
        },
    };
    return {
        ref: ref as unknown as RefObject<LyricPlayerRef | null>,
        setCurrentTime,
    };
};

afterEach(() => {
    cleanup();
    clearNativePlaybackClock();
});

describe('useAmllPlaybackClock transport stall edges', () => {
    it('resyncs as a seek at both stall edges and stays frozen between them', async () => {
        const { ref, setCurrentTime } = makePlayerRef();
        renderHook(() => useAmllPlaybackClock(ref, 0));
        act(() => updateNativePlaybackClock(snapshot, 1));
        await waitFor(() => expect(setCurrentTime).toHaveBeenCalled());
        setCurrentTime.mockClear();

        act(() => updateNativePlaybackClock({ ...snapshot, buffering: true }, 1));
        expect(setCurrentTime).toHaveBeenLastCalledWith(10000, true);
        setCurrentTime.mockClear();

        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 80));
        });
        expect(setCurrentTime.mock.calls.length).toBeGreaterThan(0);
        for (const [timeMs, isSeek] of setCurrentTime.mock.calls) {
            expect(timeMs).toBe(10000);
            expect(isSeek).toBe(false);
        }
        setCurrentTime.mockClear();

        act(() => updateNativePlaybackClock({ ...snapshot, position: 12 }, 1));
        expect(setCurrentTime).toHaveBeenLastCalledWith(12000, true);
        await waitFor(() =>
            expect(
                setCurrentTime.mock.calls.some(([timeMs, isSeek]) => !isSeek && timeMs > 12000),
            ).toBe(true),
        );
    });

    it('does not force a seek while the running flag stays unchanged', async () => {
        const { ref, setCurrentTime } = makePlayerRef();
        renderHook(() => useAmllPlaybackClock(ref, 0));
        act(() => updateNativePlaybackClock(snapshot, 1));
        await waitFor(() => expect(setCurrentTime).toHaveBeenCalled());
        setCurrentTime.mockClear();

        act(() => updateNativePlaybackClock({ ...snapshot, position: 11 }, 1));
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
        });
        expect(setCurrentTime.mock.calls.length).toBeGreaterThan(0);
        expect(setCurrentTime.mock.calls.every(([, isSeek]) => isSeek === false)).toBe(true);
    });
});
