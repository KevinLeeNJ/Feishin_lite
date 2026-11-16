import type { AudioSnapshot } from '/@/shared/backend/audio';

let anchor: undefined | { position: number; received: number; running: boolean; speed: number };

export function clearNativePlaybackClock(): void {
    anchor = undefined;
}

export function freezeNativePlaybackClock(): void {
    const position = nativePlaybackTimeMs();
    if (anchor && position !== undefined) {
        anchor = {
            ...anchor,
            position: position / 1000,
            received: performance.now(),
            running: false,
        };
    }
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

export function updateNativePlaybackClock(snapshot: AudioSnapshot, speed: number): void {
    anchor = {
        position: snapshot.position,
        received: performance.now(),
        running: !snapshot.paused && !snapshot.buffering && !snapshot.ended && !snapshot.error,
        speed,
    };
}
