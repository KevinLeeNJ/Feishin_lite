import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LyricsCacheEntry } from './cache';

import { cascadeWordLevelLyrics, getRemoteLyrics } from './orchestrate';

import {
    InternetProviderLyricSearchResponse,
    LyricSearchQuery,
    LyricsFetchOptions,
    LyricsScope,
    ProviderLyricsResult,
    Song,
} from '/@/shared/types/domain-types';
import { LyricSource } from '/@/shared/types/domain-types';

const cacheMocks = vi.hoisted(() => ({
    readCache: vi.fn(),
    recordCascadeFailure: vi.fn(),
    writeCache: vi.fn(),
    writeNegativeCache: vi.fn(),
}));

const providerMocks = vi.hoisted(() => ({
    fetch: vi.fn(),
    search: vi.fn(),
}));

vi.mock('./cache', () => cacheMocks);

vi.mock('./providers/registry', () => ({
    getProvider: (source: LyricSource) => ({
        fetch: providerMocks.fetch,
        search: (params: LyricSearchQuery) => providerMocks.search(params, source),
    }),
    PROVIDERS: [],
}));

vi.mock('/@/main/logger', () => ({
    default: { error: vi.fn() },
}));

const scope: LyricsScope = { accountId: 'acct', serverId: 'srv', songId: 'song-1' };

const fetchOptions = (overrides: Partial<LyricsFetchOptions> = {}): LyricsFetchOptions => ({
    fetchRomanization: false,
    fetchTranslation: false,
    ignoreTitleTranslation: true,
    sources: [LyricSource.NETEASE],
    ...overrides,
});

const song = {
    album: 'Album',
    artists: [{ id: 'a1', name: 'Jay Chou' }],
    duration: 240000,
    name: '夜曲（安静）',
} as Song;

const providerResult = (overrides: Partial<ProviderLyricsResult> = {}): ProviderLyricsResult => ({
    lyrics: {
        artist: 'Jay Chou',
        lyrics: [{ startMs: 0, text: 'line' }],
        name: '夜曲',
        offsetMs: null,
        remote: true,
        remoteId: 'rid-1',
        source: LyricSource.NETEASE,
        sourceFormat: 'lrc',
        timingGranularity: 'line',
    },
    romanization: null,
    translation: null,
    ...overrides,
});

const cacheEntry = (overrides: Partial<LyricsCacheEntry> = {}): LyricsCacheEntry => ({
    contentHash: 'hash',
    expiresAt: Date.now() + 60000,
    fetchedAt: Date.now(),
    result: providerResult(),
    ...overrides,
});

const candidate = (
    overrides: Partial<InternetProviderLyricSearchResponse> = {},
): InternetProviderLyricSearchResponse => ({
    artist: 'Jay Chou',
    duration: 240,
    id: 'cand',
    isSync: null,
    name: '夜曲',
    source: LyricSource.NETEASE,
    ...overrides,
});

// A candidate whose name and artist share nothing with the query, so Fuse drops it and the
// ranked list comes back empty (a failed match).
const unrelated = candidate({ artist: 'Nobody', id: 'bad', name: 'Totally Different' });

beforeEach(() => {
    vi.resetAllMocks();
    cacheMocks.readCache.mockReturnValue(null);
    providerMocks.search.mockResolvedValue([]);
    providerMocks.fetch.mockResolvedValue(null);
});

describe('getRemoteLyrics cached overlay backfill', () => {
    it('serves the cached result without refetching when the overlays were already stored', async () => {
        const cached = providerResult({
            romanization: [{ startMs: 0, text: 'ro' }],
            translation: [{ startMs: 0, text: 'tr' }],
        });
        cacheMocks.readCache.mockReturnValue(
            cacheEntry({ overlays: { romanization: true, translation: true }, result: cached }),
        );

        const result = await getRemoteLyrics(
            song,
            fetchOptions({ fetchRomanization: true, fetchTranslation: true }),
            scope,
        );

        expect(providerMocks.fetch).not.toHaveBeenCalled();
        expect(result.result).toEqual(cached);
        expect(cacheMocks.writeCache).not.toHaveBeenCalled();
    });

    it('refetches a missing romanization overlay, merges it and persists the merge', async () => {
        const fallbacks = [candidate({ id: 'fb', source: LyricSource.QQMUSIC })];
        cacheMocks.readCache.mockReturnValue(
            cacheEntry({ fallbacks, overlays: { romanization: false, translation: false } }),
        );
        const refreshed = providerResult({ romanization: [{ startMs: 0, text: 'ro' }] });
        providerMocks.fetch.mockResolvedValue(refreshed);
        const options = fetchOptions({ fetchRomanization: true });

        const result = await getRemoteLyrics(song, options, scope);

        expect(providerMocks.fetch).toHaveBeenCalledWith('rid-1', options);
        expect(result.result?.romanization).toEqual(refreshed.romanization);
        expect(result.result?.translation).toBeNull();
        // The cached lyric document itself is never replaced by the overlay refetch.
        expect(result.result?.lyrics).toEqual(providerResult().lyrics);
        expect(cacheMocks.writeCache).toHaveBeenCalledWith(
            scope,
            expect.objectContaining({ romanization: refreshed.romanization }),
            fallbacks,
            options,
        );
        // The cascade candidates survive the overlay backfill.
        expect(result.fallbacks).toEqual(fallbacks);
    });

    it('keeps the cached result untouched when the overlay refetch returns nothing', async () => {
        const cached = providerResult();
        cacheMocks.readCache.mockReturnValue(
            cacheEntry({ overlays: { romanization: false, translation: false }, result: cached }),
        );
        providerMocks.fetch.mockResolvedValue(null);

        const result = await getRemoteLyrics(song, fetchOptions({ fetchTranslation: true }), scope);

        expect(result.result).toEqual(cached);
        expect(cacheMocks.writeCache).not.toHaveBeenCalled();
    });

    it('treats a legacy entry without overlay flags as not fetched', async () => {
        cacheMocks.readCache.mockReturnValue(cacheEntry());
        const refreshed = providerResult({ translation: [{ startMs: 0, text: 'tr' }] });
        providerMocks.fetch.mockResolvedValue(refreshed);

        const result = await getRemoteLyrics(song, fetchOptions({ fetchTranslation: true }), scope);

        expect(providerMocks.fetch).toHaveBeenCalledTimes(1);
        expect(result.result?.translation).toEqual(refreshed.translation);
    });

    it('does not refetch when no overlay is requested', async () => {
        cacheMocks.readCache.mockReturnValue(cacheEntry());

        const result = await getRemoteLyrics(song, fetchOptions(), scope);

        expect(providerMocks.fetch).not.toHaveBeenCalled();
        expect(result.result).toEqual(providerResult());
    });

    it('returns no fallbacks for a final word-level cached result', async () => {
        cacheMocks.readCache.mockReturnValue(
            cacheEntry({
                fallbacks: [candidate({ id: 'fb' })],
                result: providerResult({
                    lyrics: { ...providerResult().lyrics, timingGranularity: 'word' },
                }),
            }),
        );

        const result = await getRemoteLyrics(song, fetchOptions(), scope);

        expect(result.fallbacks).toEqual([]);
    });

    it('stops returning fallbacks once the cascade failure budget is exhausted', async () => {
        cacheMocks.readCache.mockReturnValue(
            cacheEntry({ cascadeFailures: 4, fallbacks: [candidate({ id: 'fb' })] }),
        );

        const result = await getRemoteLyrics(song, fetchOptions(), scope);

        expect(result.fallbacks).toEqual([]);
    });

    it('keeps fallbacks for a non-word-level result within the retry budget', async () => {
        const fallbacks = [candidate({ id: 'fb' })];
        cacheMocks.readCache.mockReturnValue(cacheEntry({ cascadeFailures: 3, fallbacks }));

        const result = await getRemoteLyrics(song, fetchOptions(), scope);

        expect(result.fallbacks).toEqual(fallbacks);
    });
});

describe('getRemoteLyrics translated-title retry', () => {
    it('retries with the stripped title when the full title fails to match', async () => {
        providerMocks.search.mockImplementation(async (params: LyricSearchQuery) =>
            params.name === '夜曲' ? [candidate({ id: 'good', name: '夜曲' })] : [unrelated],
        );
        providerMocks.fetch.mockResolvedValue(providerResult());

        const result = await getRemoteLyrics(song, fetchOptions(), scope);

        expect(providerMocks.search).toHaveBeenCalledTimes(2);
        expect(providerMocks.search.mock.calls[1][0].name).toBe('夜曲');
        expect(providerMocks.fetch).toHaveBeenCalledWith('good', expect.anything());
        expect(result.result).not.toBeNull();
        expect(cacheMocks.writeCache).toHaveBeenCalled();
        expect(cacheMocks.writeNegativeCache).not.toHaveBeenCalled();
    });

    it('skips the retry when the ignoreTitleTranslation switch is off', async () => {
        providerMocks.search.mockResolvedValue([unrelated]);

        const result = await getRemoteLyrics(
            song,
            fetchOptions({ ignoreTitleTranslation: false }),
            scope,
        );

        expect(providerMocks.search).toHaveBeenCalledTimes(1);
        expect(providerMocks.fetch).not.toHaveBeenCalled();
        expect(result.result).toBeNull();
        expect(cacheMocks.writeNegativeCache).toHaveBeenCalledWith(scope);
    });

    it('never strips a parenthetical that names featured artists', async () => {
        providerMocks.search.mockResolvedValue([unrelated]);
        const featSong = { ...song, name: 'Song (feat. Jay Chou)' } as Song;

        await getRemoteLyrics(featSong, fetchOptions(), scope);

        expect(providerMocks.search).toHaveBeenCalledTimes(1);
        expect(cacheMocks.writeNegativeCache).toHaveBeenCalledWith(scope);
    });

    it('retries with the translation removed but the feat credit kept', async () => {
        const featSong = {
            ...song,
            name: "それで充分だよ。（That's Enough） (feat. 可不)",
        } as Song;
        const stripped = 'それで充分だよ。 (feat. 可不)';
        providerMocks.search.mockImplementation(async (params: LyricSearchQuery) =>
            params.name === stripped ? [candidate({ id: 'good', name: stripped })] : [unrelated],
        );
        providerMocks.fetch.mockResolvedValue(providerResult());

        const result = await getRemoteLyrics(featSong, fetchOptions(), scope);

        expect(providerMocks.search.mock.calls[1][0].name).toBe(stripped);
        expect(providerMocks.fetch).toHaveBeenCalledWith('good', expect.anything());
        expect(result.result).not.toBeNull();
    });

    it('keeps the original ranking when the retry still fails to match', async () => {
        providerMocks.search.mockResolvedValue([unrelated]);

        const result = await getRemoteLyrics(song, fetchOptions(), scope);

        expect(providerMocks.search).toHaveBeenCalledTimes(2);
        expect(providerMocks.fetch).not.toHaveBeenCalled();
        expect(result.result).toBeNull();
        expect(cacheMocks.writeNegativeCache).toHaveBeenCalledWith(scope);
    });

    it('keeps one fallback per other source for a line-level primary result', async () => {
        const primary = candidate({ id: 'netease-id', name: '夜曲（安静）' });
        const other = candidate({ id: 'qq-id', name: '夜曲（安静）', source: LyricSource.QQMUSIC });
        providerMocks.search.mockImplementation(
            async (_params: LyricSearchQuery, source: LyricSource) =>
                source === LyricSource.NETEASE ? [primary] : [other],
        );
        providerMocks.fetch.mockResolvedValue(providerResult());
        const options = fetchOptions({ sources: [LyricSource.NETEASE, LyricSource.QQMUSIC] });

        const result = await getRemoteLyrics(song, options, scope);

        expect(result.fallbacks.map((f) => f.id)).toEqual(['qq-id']);
        expect(cacheMocks.writeCache).toHaveBeenCalledWith(
            scope,
            expect.anything(),
            result.fallbacks,
            options,
        );
    });
});

describe('cascadeWordLevelLyrics', () => {
    const fallbacks = [
        candidate({ id: 'first', source: LyricSource.QQMUSIC }),
        candidate({ id: 'second', source: LyricSource.KUGOU }),
    ];

    it('returns the first word-level candidate and caches it without fallbacks', async () => {
        const wordResult = providerResult({
            lyrics: { ...providerResult().lyrics, timingGranularity: 'word' },
        });
        providerMocks.fetch
            .mockResolvedValueOnce(providerResult())
            .mockResolvedValueOnce(wordResult);
        const options = fetchOptions();

        const result = await cascadeWordLevelLyrics(fallbacks, options, scope, song);

        expect(result).toEqual(wordResult);
        expect(providerMocks.fetch).toHaveBeenCalledTimes(2);
        expect(cacheMocks.writeCache).toHaveBeenCalledWith(scope, wordResult, [], options);
        expect(cacheMocks.recordCascadeFailure).not.toHaveBeenCalled();
    });

    it('records a cascade failure when no candidate is word-level', async () => {
        providerMocks.fetch.mockResolvedValue(providerResult());

        const result = await cascadeWordLevelLyrics(fallbacks, fetchOptions(), scope, song);

        expect(result).toBeNull();
        expect(cacheMocks.recordCascadeFailure).toHaveBeenCalledWith(scope);
        expect(cacheMocks.writeCache).not.toHaveBeenCalled();
    });

    it('continues past a candidate whose fetch throws', async () => {
        const wordResult = providerResult({
            lyrics: { ...providerResult().lyrics, timingGranularity: 'word' },
        });
        providerMocks.fetch
            .mockRejectedValueOnce(new Error('network'))
            .mockResolvedValueOnce(wordResult);

        const result = await cascadeWordLevelLyrics(fallbacks, fetchOptions(), scope, song);

        expect(result).toEqual(wordResult);
        expect(cacheMocks.recordCascadeFailure).not.toHaveBeenCalled();
    });

    it('skips a cached fallback whose title or artist does not match the song', async () => {
        const poisoned = candidate({
            artist: '王子健',
            id: 'poison',
            name: '循迹',
            source: LyricSource.QQMUSIC,
        });
        const wordResult = providerResult({
            lyrics: { ...providerResult().lyrics, timingGranularity: 'word' },
        });
        providerMocks.fetch.mockResolvedValue(wordResult);

        const result = await cascadeWordLevelLyrics(
            [poisoned, ...fallbacks],
            fetchOptions(),
            scope,
            song,
        );

        expect(result).toEqual(wordResult);
        expect(providerMocks.fetch).toHaveBeenCalledTimes(1);
        expect(providerMocks.fetch).toHaveBeenCalledWith('first', expect.anything());
    });
});
