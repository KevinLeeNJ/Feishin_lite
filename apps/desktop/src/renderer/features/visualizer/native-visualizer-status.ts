import { useSyncExternalStore } from 'react';

let failed = false;
const listeners = new Set<() => void>();

export function setNativeVisualizerFailed(next: boolean): void {
    if (next === failed) return;
    failed = next;
    listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export const useNativeVisualizerFailed = () => useSyncExternalStore(subscribe, () => failed);
