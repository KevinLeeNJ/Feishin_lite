import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    cacheKey,
    clearAllCache,
    readCache,
    recordCascadeFailure,
    writeCache,
    writeNegativeCache,
} from './cache';

import {
    LyricsFetchOptions,
    LyricsScope,
    ProviderLyricsResult,
} from '/@/shared/types/domain-types';
import { LyricSource } from '/@/shared/types/domain-types';

const storeState = vi.hoisted(() => ({ map: new Map<string, any>() }));

vi.mock('electron-store', () => ({
    default: class {
        get store() {
            return Object.fromEntries(storeState.map);
        }

        clear() {
            storeState.map.clear();
        }

        delete(key: string) {
            storeState.map.delete(key);
        }

        get(key: string) {
            return storeState.map.get(key);
        }

        set(key: string, value: any) {
            storeState.map.set(key, value);
        }
    },
}));

const scope: LyricsScope = { accountId: 'acct', serverId: 'srv', songId: 'song-1' };

const result: ProviderLyricsResult = {
    lyrics: {
        artist: 'Jay Chou',
        lyrics: [{ startMs: 0, text: 'line' }],
        name: '夜曲',
        remote: true,
        remoteId: 'rid-1',
        source: LyricSource.NETEASE,
        timingGranularity: 'line',
    },
    romanization: null,
    translation: null,
};

const options = (overrides: Partial<LyricsFetchOptions> = {}): LyricsFetchOptions => ({
    fetchRomanization: false,
    fetchTranslation: false,
    ignoreTitleTranslation: true,
    sources: [LyricSource.NETEASE],
    ...overrides,
});

beforeEach(() => {
    storeState.map.clear();
});

describe('lyrics cache overlay flags', () => {
    it('persists the overlay flags used at fetch time', () => {
        writeCache(scope, result, [], options({ fetchRomanization: true, fetchTranslation: true }));

        expect(readCache(scope)?.overlays).toEqual({ romanization: true, translation: true });
    });

    it('records false flags when no options are given', () => {
        writeCache(scope, result);

        expect(readCache(scope)?.overlays).toEqual({ romanization: false, translation: false });
    });

    it('reads a legacy entry without overlay flags unchanged', () => {
        storeState.map.set(cacheKey(scope), {
            contentHash: 'hash',
            expiresAt: Date.now() + 60000,
            fetchedAt: Date.now(),
            result,
        });

        const entry = readCache(scope);

        expect(entry?.result).toEqual(result);
        expect(entry?.overlays).toBeUndefined();
    });
});

describe('lyrics cache expiry and cascade counting', () => {
    it('drops an expired entry on read', () => {
        writeCache(scope, result);
        const stored = storeState.map.get(cacheKey(scope));
        storeState.map.set(cacheKey(scope), { ...stored, expiresAt: Date.now() - 1 });

        expect(readCache(scope)).toBeNull();
        expect(storeState.map.has(cacheKey(scope))).toBe(false);
    });

    it('gives negative entries a much shorter ttl than positive ones', () => {
        writeCache(scope, result);
        const positive = storeState.map.get(cacheKey(scope));
        writeNegativeCache(scope);
        const negative = storeState.map.get(cacheKey(scope));

        expect(negative.result).toBeNull();
        expect(negative.expiresAt - negative.fetchedAt).toBeLessThan(
            positive.expiresAt - positive.fetchedAt,
        );
    });

    it('increments the cascade failure count while preserving the entry', () => {
        writeCache(scope, result);

        recordCascadeFailure(scope);
        recordCascadeFailure(scope);

        const entry = readCache(scope);
        expect(entry?.cascadeFailures).toBe(2);
        expect(entry?.result).toEqual(result);
    });

    it('ignores a cascade failure when nothing is cached', () => {
        recordCascadeFailure(scope);

        expect(storeState.map.size).toBe(0);
    });

    it('clears every entry including cascade failure counts', () => {
        writeCache(scope, result);
        recordCascadeFailure(scope);
        writeNegativeCache({ ...scope, songId: 'song-2' });

        clearAllCache();

        expect(storeState.map.size).toBe(0);
    });
});
