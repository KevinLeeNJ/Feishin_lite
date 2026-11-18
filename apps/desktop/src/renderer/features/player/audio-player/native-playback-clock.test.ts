import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    clearNativePlaybackClock,
    freezeNativePlaybackClock,
    nativePlaybackRunning,
    nativePlaybackTimeMs,
    subscribeNativePlaybackRunning,
    updateNativePlaybackClock,
} from './native-playback-clock';

import { AudioSnapshot } from '/@/shared/backend/audio';

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

afterEach(() => {
    clearNativePlaybackClock();
    vi.restoreAllMocks();
});

describe('native audio clock projection', () => {
    it('interpolates by media rate and caps extrapolation after a stalled transport', () => {
        const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
        updateNativePlaybackClock(snapshot, 2);
        now.mockReturnValue(1100);
        expect(nativePlaybackTimeMs()).toBe(10200);
        now.mockReturnValue(5000);
        expect(nativePlaybackTimeMs()).toBe(10500);
    });

    it('freezes on pause, buffering and completion', () => {
        const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
        for (const state of [{ paused: true }, { buffering: true }, { ended: true }]) {
            updateNativePlaybackClock({ ...snapshot, ...state }, 0.5);
            now.mockReturnValue(2000);
            expect(nativePlaybackTimeMs()).toBe(10000);
        }
    });

    it('rebases the visible position immediately when paused and clears on seek or unmount', () => {
        const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
        updateNativePlaybackClock(snapshot, 1);
        now.mockReturnValue(1100);
        freezeNativePlaybackClock();
        now.mockReturnValue(1400);
        expect(nativePlaybackTimeMs()).toBe(10100);
        clearNativePlaybackClock();
        expect(nativePlaybackTimeMs()).toBeUndefined();
    });
});

describe('native transport running signal', () => {
    it('reports running without a native session so non-native clocks stay in charge', () => {
        expect(nativePlaybackRunning()).toBe(true);
    });

    it('notifies subscribers only when the running flag flips', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeNativePlaybackRunning(listener);

        updateNativePlaybackClock(snapshot, 1);
        expect(listener).not.toHaveBeenCalled();

        updateNativePlaybackClock({ ...snapshot, buffering: true }, 1);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(nativePlaybackRunning()).toBe(false);

        updateNativePlaybackClock({ ...snapshot, buffering: true, position: 11 }, 1);
        expect(listener).toHaveBeenCalledTimes(1);

        updateNativePlaybackClock(snapshot, 1);
        expect(listener).toHaveBeenCalledTimes(2);
        expect(nativePlaybackRunning()).toBe(true);

        unsubscribe();
        updateNativePlaybackClock({ ...snapshot, paused: true }, 1);
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('publishes the running edge on freeze and clear', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeNativePlaybackRunning(listener);
        updateNativePlaybackClock(snapshot, 1);

        freezeNativePlaybackClock();
        expect(nativePlaybackRunning()).toBe(false);
        expect(listener).toHaveBeenCalledTimes(1);

        clearNativePlaybackClock();
        expect(nativePlaybackRunning()).toBe(true);
        expect(listener).toHaveBeenCalledTimes(2);
        unsubscribe();
    });
});
