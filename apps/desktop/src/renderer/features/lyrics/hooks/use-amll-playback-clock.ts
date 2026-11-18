import type { LyricPlayerRef } from '@applemusic-like-lyrics/react';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import {
    nativePlaybackTimeMs,
    subscribeNativePlaybackRunning,
} from '/@/renderer/features/player/audio-player/native-playback-clock';
import { subscribePlayerSpeed, subscribePlayerStatus, usePlayerStoreBase } from '/@/renderer/store';
import { subscribePlayerProgress, useTimestampStoreBase } from '/@/renderer/store/timestamp.store';
import { PlayerStatus } from '/@/shared/types/types';

// Backward deviation below this is polling jitter and gets clamped away;
// anything larger is a real backward seek and must re-sync AMLL explicitly.
const SEEK_BACKWARD_TOLERANCE_MS = 100;
const BOOTSTRAP_MAX_FRAMES = 120;

/**
 * Drives AMLL's imperative playback clock. The shared timestamp store updates a
 * few times per second; between updates a performance.now() anchor interpolates
 * the position (scaled by playback speed) so requestAnimationFrame can push
 * smooth setCurrentTime calls without rebuilding the React tree each frame.
 *
 * The pushed clock is monotonic while playing: AMLL treats any backward step as
 * a seek and restarts the interlude dot performance with a 500ms invisible hold,
 * so raw polling samples (whose IPC latency jitters) must never move it back.
 * Status/speed changes rebase the anchor to the current smooth estimate (not the
 * lagging polled sample) so pausing freezes the highlight at the visible position
 * instead of stepping it backward, and resuming continues from there.
 */
export const useAmllPlaybackClock = (
    playerRef: React.RefObject<LyricPlayerRef | null>,
    offsetMs: number,
    enabled = true,
    rebuildKey?: unknown,
) => {
    const offsetRef = useRef(offsetMs);
    const statusRef = useRef<PlayerStatus>(PlayerStatus.STOPPED);
    const speedRef = useRef(1);
    const anchorRef = useRef({ perfTime: 0, timeMs: 0 });
    const playRafRef = useRef<null | number>(null);
    const bootstrapRafRef = useRef<null | number>(null);
    const lastPushedRef = useRef(0);

    const interpolatedTimeMs = useCallback(() => {
        const native = nativePlaybackTimeMs();
        if (native !== undefined) {
            return native + offsetRef.current;
        }
        const anchor = anchorRef.current;
        const elapsed =
            statusRef.current === PlayerStatus.PLAYING
                ? (performance.now() - anchor.perfTime) * speedRef.current
                : 0;
        return anchor.timeMs + elapsed + offsetRef.current;
    }, []);

    // AMLL drives the per-word karaoke fill with Web Animations (`fade-word-*`)
    // that it always plays at playbackRate 1, so at 0.5x/2x the fill runs at 1x
    // while line switching follows the speed-scaled media clock. Scale those
    // animations with the media rate so word highlighting matches playback.
    const applyWordAnimationRate = useCallback(
        (rate: number) => {
            const element = playerRef.current?.lyricPlayer?.getElement();
            if (!element) {
                return;
            }
            for (const animation of element.getAnimations({ subtree: true })) {
                if (animation.id.startsWith('fade-word-') && animation.playbackRate !== rate) {
                    animation.playbackRate = rate;
                }
            }
        },
        [playerRef],
    );

    const pushTime = useCallback(
        (isSeek: boolean): boolean => {
            const player = playerRef.current?.lyricPlayer;
            if (!player) {
                return false;
            }
            let timeMs = Math.round(interpolatedTimeMs());
            if (
                !isSeek &&
                statusRef.current === PlayerStatus.PLAYING &&
                timeMs < lastPushedRef.current
            ) {
                timeMs = lastPushedRef.current;
            }
            player.setCurrentTime(timeMs, isSeek);
            lastPushedRef.current = timeMs;
            // Line activation resets the word animations to rate 1; re-apply the
            // speed-scaled rate afterwards so each new line's fill stays in sync.
            if (speedRef.current !== 1) {
                applyWordAnimationRate(speedRef.current);
            }
            return true;
        },
        [applyWordAnimationRate, interpolatedTimeMs, playerRef],
    );

    // Authoritative re-sync to the latest polled sample: mount, offset change, progress poll.
    const resetAnchor = useCallback(() => {
        anchorRef.current = {
            perfTime: performance.now(),
            timeMs: useTimestampStoreBase.getState().timestamp * 1000,
        };
    }, []);

    // Continuous rebase to the current smooth estimate. Captures the playing
    // interpolation before the status flips so the clock never steps back to the
    // lagging polled sample on pause/resume or speed change.
    const rebaseToEstimate = useCallback(() => {
        anchorRef.current = {
            perfTime: performance.now(),
            timeMs: interpolatedTimeMs() - offsetRef.current,
        };
    }, [interpolatedTimeMs]);

    const stopRaf = useCallback(() => {
        if (playRafRef.current !== null) {
            cancelAnimationFrame(playRafRef.current);
            playRafRef.current = null;
        }
        if (bootstrapRafRef.current !== null) {
            cancelAnimationFrame(bootstrapRafRef.current);
            bootstrapRafRef.current = null;
        }
    }, []);

    const startPlayRaf = useCallback(() => {
        stopRaf();
        const tick = () => {
            if (statusRef.current !== PlayerStatus.PLAYING) {
                stopRaf();
                return;
            }
            pushTime(false);
            playRafRef.current = requestAnimationFrame(tick);
        };
        playRafRef.current = requestAnimationFrame(tick);
    }, [pushTime, stopRaf]);

    // Push the current anchor once the player instance exists; on first mount it
    // may not be created yet, so poll briefly until it is.
    const pushWhenReady = useCallback(() => {
        if (pushTime(true)) {
            return;
        }
        let frames = 0;
        const poll = () => {
            if (pushTime(true) || frames >= BOOTSTRAP_MAX_FRAMES) {
                bootstrapRafRef.current = null;
                return;
            }
            frames += 1;
            bootstrapRafRef.current = requestAnimationFrame(poll);
        };
        bootstrapRafRef.current = requestAnimationFrame(poll);
    }, [pushTime]);

    useEffect(() => {
        if (!enabled) return;
        offsetRef.current = offsetMs;
        resetAnchor();
        if (statusRef.current === PlayerStatus.PLAYING) {
            pushTime(true);
        } else {
            pushWhenReady();
        }
    }, [enabled, offsetMs, pushTime, pushWhenReady, resetAnchor]);

    useEffect(() => {
        if (!enabled) return;
        statusRef.current = usePlayerStoreBase.getState().player.status;
        speedRef.current = usePlayerStoreBase.getState().player.speed;
        resetAnchor();
        if (statusRef.current === PlayerStatus.PLAYING) {
            startPlayRaf();
        } else {
            pushWhenReady();
        }

        const unsubscribe = subscribePlayerStatus(({ status }) => {
            rebaseToEstimate();
            statusRef.current = status;
            if (status === PlayerStatus.PLAYING) {
                startPlayRaf();
            } else {
                stopRaf();
                pushWhenReady();
            }
        });

        // Rate change rebases at the current estimate so the clock stays continuous;
        // only subsequent interpolation uses the new speed. Word animations are
        // scaled immediately (including resetting to 1) to track the media rate.
        const unsubscribeSpeed = subscribePlayerSpeed(({ speed }) => {
            rebaseToEstimate();
            speedRef.current = speed;
            applyWordAnimationRate(speed);
        });

        return () => {
            unsubscribe();
            unsubscribeSpeed();
            stopRaf();
        };
    }, [
        applyWordAnimationRate,
        enabled,
        pushWhenReady,
        rebaseToEstimate,
        resetAnchor,
        startPlayRaf,
        stopRaf,
    ]);

    useEffect(() => {
        if (!enabled) return;
        const unsubscribe = subscribePlayerProgress(({ timestamp }) => {
            const sampleMs = timestamp * 1000 + offsetRef.current;
            const isSeek = sampleMs - interpolatedTimeMs() < -SEEK_BACKWARD_TOLERANCE_MS;
            resetAnchor();
            if (statusRef.current !== PlayerStatus.PLAYING || isSeek) {
                pushTime(true);
            }
            // While playing the RAF loop pushes the re-anchored estimate on the
            // next frame. Forward jumps ride AMLL's own seek tolerance; backward
            // jitter is clamped in pushTime so it never restarts the interlude
            // dot performance, which AMLL rebuilds on any detected seek.
        });
        return unsubscribe;
    }, [enabled, interpolatedTimeMs, pushTime, resetAnchor]);

    // Transport stalls (seek into unbuffered data, underrun) freeze the polled position, so
    // progress events stop arriving while AMLL's word fill keeps running on its own Web
    // Animations timeline. The clock publishes only running edges; re-sync as an explicit
    // seek at both: entering, so the fill pauses at the exact frozen word position instead
    // of wherever the animation ran to; leaving, so it resumes without the lead accumulated
    // before the pause landed.
    useEffect(() => {
        if (!enabled) return;
        return subscribeNativePlaybackRunning(() => pushTime(true));
    }, [enabled, pushTime]);

    // Any lyric line rebuild (overlays resolving, settings change, or a fullscreen
    // remount) makes AMLL rebuild at time 0 through a stale internal ref. While
    // paused nothing re-pushes afterwards, so the view sticks at the song start.
    // Restore the frozen position after the rebuild commits, before paint.
    useLayoutEffect(() => {
        if (!enabled) return;
        if (statusRef.current !== PlayerStatus.PLAYING) {
            pushWhenReady();
        }
    }, [enabled, pushWhenReady, rebuildKey]);
};
