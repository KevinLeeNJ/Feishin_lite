// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AmllLyricsView } from './amll-lyrics-view';

import {
    clearNativePlaybackClock,
    updateNativePlaybackClock,
} from '/@/renderer/features/player/audio-player/native-playback-clock';
import { AudioSnapshot } from '/@/shared/backend/audio';
import { SynchronizedLyrics } from '/@/shared/types/domain-types';

const captured = vi.hoisted(() => ({ props: [] as Array<{ playing?: boolean }> }));

vi.mock('@applemusic-like-lyrics/react', () => ({
    LyricPlayer: (props: { playing?: boolean }) => {
        captured.props.push(props);
        return null;
    },
}));

vi.mock('is-electron', () => ({ default: () => false }));

vi.mock('/@/renderer/store', () => {
    const state = { player: { speed: 1, status: 'playing' } };
    const usePlayerStoreBase = (selector: (s: typeof state) => unknown) => selector(state);
    usePlayerStoreBase.getState = () => state;
    return {
        subscribePlayerSpeed: () => () => {},
        subscribePlayerStatus: () => () => {},
        useLyricsDisplaySettings: () => ({}),
        useLyricsSettings: () => ({
            alignment: 'center',
            followScrollAlignment: 0,
            showMatch: false,
            showProvider: false,
        }),
        usePlaybackType: () => 'local',
        usePlayerActions: () => ({ mediaSeekToTimestamp: vi.fn() }),
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

const lyrics: SynchronizedLyrics = [
    { startMs: 0, text: 'first line' },
    { startMs: 4000, text: 'second line' },
];

const lastPlaying = () => captured.props[captured.props.length - 1]?.playing;

beforeEach(() => {
    captured.props.length = 0;
});

afterEach(() => {
    cleanup();
    clearNativePlaybackClock();
});

describe('AmllLyricsView playing gate', () => {
    it('pauses AMLL while the transport stalls even though status stays playing', () => {
        render(<AmllLyricsView lyrics={lyrics} />);
        act(() => updateNativePlaybackClock(snapshot, 1));
        expect(lastPlaying()).toBe(true);

        act(() => updateNativePlaybackClock({ ...snapshot, buffering: true }, 1));
        expect(lastPlaying()).toBe(false);

        act(() => updateNativePlaybackClock({ ...snapshot, position: 12 }, 1));
        expect(lastPlaying()).toBe(true);
    });
});
