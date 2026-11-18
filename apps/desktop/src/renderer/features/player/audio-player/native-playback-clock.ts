import type { AudioSnapshot } from '/@/shared/backend/audio';

let anchor:
    | undefined
    | {
          position: number;
          received: number;
          running: boolean;
          speed: number;
          transitionRateMismatch?: boolean;
      };

const transitionListeners = new Set<() => void>();
const runningListeners = new Set<() => void>();

// Word-level lyric fill runs on Web Animations timelines that only pause through AMLL's
// playing flag, so consumers must re-render when the transport stalls (seek into unbuffered
// data, underrun) even though the polled position - and thus progress events - stay frozen.
const publish = (next: typeof anchor): void => {
    const wasRunning = anchor?.running ?? true;
    const wasRateMismatch = nativeTransitionRateMismatch();
    anchor = next;
    if (wasRateMismatch !== nativeTransitionRateMismatch()) {
        for (const listener of transitionListeners) listener();
    }
    const isRunning = next?.running ?? true;
    if (wasRunning !== isRunning) {
        for (const listener of runningListeners) listener();
    }
};

export function clearNativePlaybackClock(): void {
    publish(undefined);
}

export function freezeNativePlaybackClock(): void {
    const position = nativePlaybackTimeMs();
    if (anchor && position !== undefined) {
        publish({
            ...anchor,
            position: position / 1000,
            received: performance.now(),
            running: false,
        });
    }
}

/** True while the native transport advances; without a native session the caller's own clock rules. */
export function nativePlaybackRunning(): boolean {
    return anchor?.running ?? true;
}

export function nativePlaybackTimeMs(): number | undefined {
    if (!anchor) {
        return undefined;
    }
    const elapsed = anchor.running
        ? Math.min(250, performance.now() - anchor.received) * anchor.speed
        : 0;
    return anchor.position * 1000 + elapsed;
}

export function nativeTransitionRateMismatch(): boolean {
    return anchor?.transitionRateMismatch ?? false;
}

export function subscribeNativePlaybackRunning(listener: () => void): () => void {
    runningListeners.add(listener);
    return () => {
        runningListeners.delete(listener);
    };
}

export function subscribeNativeTransitionRateMismatch(listener: () => void): () => void {
    transitionListeners.add(listener);
    return () => {
        transitionListeners.delete(listener);
    };
}

export function updateNativePlaybackClock(snapshot: AudioSnapshot, speed: number): void {
    publish({
        position: snapshot.position,
        received: performance.now(),
        running: !snapshot.paused && !snapshot.buffering && !snapshot.ended && !snapshot.error,
        speed,
        transitionRateMismatch: snapshot.transitionRateMismatch,
    });
}
