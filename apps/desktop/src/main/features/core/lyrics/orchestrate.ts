import { readCache, recordCascadeFailure, writeCache, writeNegativeCache } from './cache';
import { getProvider, PROVIDERS } from './providers/registry';
import { orderSearchResults, selectWordLevelFallbacks } from './shared';

import log from '/@/main/logger';
import {
    InternetProviderLyricSearchResponse,
    LyricGetQuery,
    LyricSearchQuery,
    LyricsFetchOptions,
    LyricsScope,
    ProviderLyricsResult,
    RemoteLyricsAutoResult,
    Song,
} from '/@/shared/types/domain-types';
import { LyricSource } from '/@/shared/types/domain-types';

const MATCH_THRESHOLD = 0.55;
// After this many exhausted cascades a song is treated as having no word-level version and stops
// retrying. Only clearing the lyrics cache in settings resets the count.
const MAX_CASCADE_FAILURES = 3;

const buildSearchParams = (song: Song): LyricSearchQuery => {
    const params: LyricSearchQuery = {
        album: song.album || song.name,
        duration: song.duration / 1000.0,
        name: song.name,
    };

    const artist = song.artists?.[0]?.name || song.artistName || song.albumArtistName;
    if (artist) {
        params.artist = artist;
    }

    return params;
};

const searchAllSources = async (
    params: LyricSearchQuery,
    sources: LyricSource[],
): Promise<InternetProviderLyricSearchResponse[]> => {
    const settled = await Promise.allSettled(
        sources.map(async (source) => {
            const provider = getProvider(source);
            const results = provider ? await provider.search(params) : null;
            return { results, source };
        }),
    );

    const all: InternetProviderLyricSearchResponse[] = [];

    for (const outcome of settled) {
        if (outcome.status === 'fulfilled' && outcome.value.results) {
            all.push(...outcome.value.results);
        } else if (outcome.status === 'rejected') {
            log.error('Lyrics search failed:', outcome.reason);
        }
    }

    return all;
};

const fetchBestMatch = async (
    bestMatch: InternetProviderLyricSearchResponse,
    options: LyricsFetchOptions,
): Promise<null | ProviderLyricsResult> => {
    const provider = getProvider(bestMatch.source);
    if (!provider) {
        return null;
    }

    const result = await provider.fetch(bestMatch.id, options);
    if (!result) {
        return null;
    }

    result.lyrics.artist = bestMatch.artist;
    result.lyrics.name = bestMatch.name;
    result.lyrics.matchConfidence = 1 - (bestMatch.score ?? 1);

    return result;
};

/** Auto-fetch lyrics for a song, serving the persistent cache before hitting providers. */
export const getRemoteLyrics = async (
    song: Song,
    options: LyricsFetchOptions,
    scope: LyricsScope,
): Promise<RemoteLyricsAutoResult> => {
    const cached = readCache(scope);
    if (cached) {
        // A cached non-word-level result keeps its candidates so the cascade retries on later
        // plays (no re-search), until too many attempts have failed. Word-level results are final.
        const isWordLevel = cached.result?.lyrics.timingGranularity === 'word';
        const gaveUp = (cached.cascadeFailures ?? 0) > MAX_CASCADE_FAILURES;
        return {
            fallbacks: !isWordLevel && !gaveUp ? (cached.fallbacks ?? []) : [],
            result: cached.result,
        };
    }

    const params = buildSearchParams(song);
    const ranked = orderSearchResults({
        params,
        results: await searchAllSources(params, options.sources),
    });

    const bestMatch = ranked[0];
    if (!bestMatch || (bestMatch.score ?? 1) > MATCH_THRESHOLD) {
        writeNegativeCache(scope);
        return { fallbacks: [], result: null };
    }

    try {
        const result = await fetchBestMatch(bestMatch, options);
        if (result) {
            // Word-level already: no cascade needed. Otherwise keep the remaining acceptable
            // candidates (one per source) for the background cascade and for retry on later plays.
            const fallbacks =
                result.lyrics.timingGranularity === 'word'
                    ? []
                    : selectWordLevelFallbacks({ bestMatch, maxScore: MATCH_THRESHOLD, ranked });
            writeCache(scope, result, fallbacks);
            return { fallbacks, result };
        }
        writeNegativeCache(scope);
        return { fallbacks: [], result: null };
    } catch (error) {
        log.error(`Error fetching lyrics from ${bestMatch.source}:`, error);
        writeNegativeCache(scope);
        return { fallbacks: [], result: null };
    }
};

/**
 * Word-level-first cascade: try the fallback candidates in ranked order (one per source) and
 * return the first word-level result, caching it so later plays skip the cascade. Non-word-level
 * results are discarded (the primary result stays displayed). Returns null when none is word-level.
 */
export const cascadeWordLevelLyrics = async (
    fallbacks: InternetProviderLyricSearchResponse[],
    options: LyricsFetchOptions,
    scope: LyricsScope,
): Promise<null | ProviderLyricsResult> => {
    for (const candidate of fallbacks) {
        try {
            const result = await fetchBestMatch(candidate, options);
            if (result && result.lyrics.timingGranularity === 'word') {
                writeCache(scope, result);
                return result;
            }
        } catch (error) {
            log.error(`Lyrics word-level cascade failed for ${candidate.source}:`, error);
        }
    }

    // No word-level version found this attempt; count it so retrying eventually stops.
    recordCascadeFailure(scope);
    return null;
};

/** Search every enabled source and group candidates by source for the manual picker. */
export const searchRemoteLyrics = async (
    params: LyricSearchQuery,
    sources: LyricSource[],
): Promise<Record<LyricSource, InternetProviderLyricSearchResponse[]>> => {
    const results = {} as Record<LyricSource, InternetProviderLyricSearchResponse[]>;
    for (const source of Object.values(LyricSource)) {
        results[source] = [];
    }

    for (const item of await searchAllSources(params, sources)) {
        results[item.source].push(item);
    }

    return results;
};

/** Fetch a manually selected candidate by its provider id (override path). */
export const getRemoteLyricsById = async (
    query: LyricGetQuery,
    options: LyricsFetchOptions,
): Promise<null | ProviderLyricsResult> => {
    const provider = getProvider(query.remoteSource);
    if (!provider) {
        return null;
    }

    try {
        return await provider.fetch(query.remoteSongId, options);
    } catch (error) {
        log.error(`Error fetching lyrics from ${query.remoteSource}:`, error);
        return null;
    }
};

export { PROVIDERS };
