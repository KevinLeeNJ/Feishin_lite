import Store from 'electron-store';
import md5 from 'md5';

import {
    InternetProviderLyricSearchResponse,
    LyricsScope,
    ProviderLyricsResult,
} from '/@/shared/types/domain-types';

/** A cached auto-fetch outcome. `result === null` is a short-lived negative entry. */
export interface LyricsCacheEntry {
    /** Consecutive cascade attempts that found no word-level version; > threshold stops retrying. */
    cascadeFailures?: number;
    contentHash: string;
    expiresAt: number;
    /** Ranked cascade candidates kept so a non-word-level result can retry without re-searching. */
    fallbacks?: InternetProviderLyricSearchResponse[];
    fetchedAt: number;
    result: null | ProviderLyricsResult;
}

const POSITIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 500;

// Lazily construct the store on first use. electron-store resolves userData at construction time;
// building it at module import would latch the pre-`app.setPath` (prod) userData in dev, because
// this module is imported before main/index.ts redirects userData to the `-dev` directory.
let cacheStoreInstance: null | Store<Record<string, LyricsCacheEntry>> = null;
const getCacheStore = (): Store<Record<string, LyricsCacheEntry>> =>
    (cacheStoreInstance ??= new Store<Record<string, LyricsCacheEntry>>({
        defaults: {},
        name: 'lyrics-cache',
    }));

export const cacheKey = (scope: LyricsScope): string =>
    `${scope.serverId}:${scope.accountId}:${scope.songId}`;

const contentHashOf = (result: ProviderLyricsResult): string =>
    md5(JSON.stringify(result.lyrics.lyrics));

const evictOverflow = (): void => {
    const all = getCacheStore().store;
    const keys = Object.keys(all);

    if (keys.length <= MAX_ENTRIES) {
        return;
    }

    const oldest = keys
        .sort((a, b) => all[a].fetchedAt - all[b].fetchedAt)
        .slice(0, keys.length - MAX_ENTRIES);

    for (const key of oldest) {
        getCacheStore().delete(key);
    }
};

/** Read a non-expired entry, or null when absent/expired. */
export const readCache = (scope: LyricsScope): LyricsCacheEntry | null => {
    const entry = getCacheStore().get(cacheKey(scope));

    if (!entry) {
        return null;
    }

    if (entry.expiresAt <= Date.now()) {
        getCacheStore().delete(cacheKey(scope));
        return null;
    }

    return entry;
};

export const writeCache = (
    scope: LyricsScope,
    result: ProviderLyricsResult,
    fallbacks: InternetProviderLyricSearchResponse[] = [],
): void => {
    const now = Date.now();
    getCacheStore().set(cacheKey(scope), {
        contentHash: contentHashOf(result),
        expiresAt: now + POSITIVE_TTL_MS,
        fallbacks,
        fetchedAt: now,
        result,
    });
    evictOverflow();
};

/** Record a failed/empty fetch so repeated playback does not re-hit the network. */
export const writeNegativeCache = (scope: LyricsScope): void => {
    const now = Date.now();
    getCacheStore().set(cacheKey(scope), {
        contentHash: '',
        expiresAt: now + NEGATIVE_TTL_MS,
        fetchedAt: now,
        result: null,
    });
    evictOverflow();
};

export const clearCache = (scope: LyricsScope): void => {
    getCacheStore().delete(cacheKey(scope));
};

/** Count one exhausted cascade (no word-level found) so retrying eventually stops. */
export const recordCascadeFailure = (scope: LyricsScope): void => {
    const entry = getCacheStore().get(cacheKey(scope));
    if (entry) {
        getCacheStore().set(cacheKey(scope), {
            ...entry,
            cascadeFailures: (entry.cascadeFailures ?? 0) + 1,
        });
    }
};

/** Clear every lyrics entry (positive and negative), resetting all cascade failure counts. */
export const clearAllCache = (): void => {
    getCacheStore().clear();
};
