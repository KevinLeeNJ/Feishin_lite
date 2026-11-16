import Fuse, { FuseResult, IFuseOptions } from 'fuse.js';

import {
    InternetProviderLyricSearchResponse,
    LyricSearchQuery,
    LyricSource,
} from '/@/shared/types/domain-types';

// Different sources round track length by a few seconds; gaps within this tolerance are ignored.
const DURATION_TOLERANCE_SECONDS = 3;
// Different versions (live/remix/cover) usually diverge by far more than the tolerance. Steepen
// the slope so a moderately wrong-length version is demoted decisively, while a strong name/artist
// match still has a say (the penalty is capped, not a hard veto).
const DURATION_PENALTY_SLOPE = 3;
// Cap the penalty so a wrong-length version ranks lower (and can fail the match threshold)
// without fully overriding a strong name/artist match.
const MAX_DURATION_PENALTY = 0.5;

/**
 * Penalty added to the fuzzy match score when a candidate's duration diverges from the real
 * song. Unknown duration on either side is neutral (no penalty), so sources that do not report
 * a duration are neither rewarded nor punished relative to those that do.
 */
const durationPenalty = (candidateSeconds?: number, songSeconds?: number): number => {
    if (!candidateSeconds || !songSeconds || candidateSeconds <= 0 || songSeconds <= 0) {
        return 0;
    }

    const diff = Math.abs(candidateSeconds - songSeconds);

    if (diff <= DURATION_TOLERANCE_SECONDS) {
        return 0;
    }

    return Math.min(
        MAX_DURATION_PENALTY,
        ((diff - DURATION_TOLERANCE_SECONDS) / songSeconds) * DURATION_PENALTY_SLOPE,
    );
};

export const orderSearchResults = (args: {
    params: LyricSearchQuery;
    results: InternetProviderLyricSearchResponse[];
}) => {
    const { params, results } = args;

    const options: IFuseOptions<InternetProviderLyricSearchResponse> = {
        fieldNormWeight: 1,
        includeScore: true,
        keys: [
            { getFn: (song) => song.name, name: 'name', weight: 2 },
            { getFn: (song) => song.artist, name: 'artist', weight: 2 },
        ],
        threshold: 0.6,
    };

    const fuse = new Fuse(results, options);

    let searchResults: Array<FuseResult<InternetProviderLyricSearchResponse>>;

    if (params.artist && params.name) {
        const artistFuse = new Fuse(results, {
            includeScore: true,
            keys: [{ getFn: (song) => song.artist, name: 'artist' }],
            threshold: 0.6,
        });

        const nameFuse = new Fuse(results, {
            includeScore: true,
            keys: [{ getFn: (song) => song.name, name: 'name' }],
            threshold: 0.6,
        });

        const artistResults = artistFuse.search(params.artist);
        const nameResults = nameFuse.search(params.name);

        const artistScores = new Map(artistResults.map((r) => [r.item.id, r.score ?? 1]));
        const nameScores = new Map(nameResults.map((r) => [r.item.id, r.score ?? 1]));

        const combinedResults = new Map<string, FuseResult<InternetProviderLyricSearchResponse>>();

        artistResults.forEach((result) => {
            const nameScore = nameScores.get(result.item.id);
            if (nameScore !== undefined) {
                const combinedScore = Math.max(result.score ?? 1, nameScore);
                combinedResults.set(result.item.id, {
                    ...result,
                    score: combinedScore,
                });
            }
        });

        nameResults.forEach((result) => {
            if (!combinedResults.has(result.item.id)) {
                const artistScore = artistScores.get(result.item.id);
                if (artistScore !== undefined) {
                    const combinedScore = Math.max(result.score ?? 1, artistScore);
                    combinedResults.set(result.item.id, {
                        ...result,
                        score: combinedScore,
                    });
                }
            }
        });

        searchResults = Array.from(combinedResults.values());
    } else {
        searchResults = fuse.search({
            ...(params.artist && { artist: params.artist }),
            ...(params.name && { name: params.name }),
        });
    }

    for (const result of searchResults) {
        result.score = (result.score ?? 0) + durationPenalty(result.item.duration, params.duration);
    }

    const sortedResults = searchResults.sort((a, b) => {
        const aIsSync = a.item.isSync === true ? 1 : 0;
        const bIsSync = b.item.isSync === true ? 1 : 0;

        if (aIsSync !== bIsSync) {
            return bIsSync - aIsSync;
        }

        return (a.score || 0) - (b.score || 0);
    });

    return sortedResults.map((result) => ({
        ...result.item,
        score: result.score,
    }));
};

/**
 * Pick fallback candidates for the word-level cascade: everything ranked at or below the best
 * match that is still an acceptable match (score <= maxScore), keeping only the highest-ranked
 * candidate per source and excluding the best match's own source (already fetched). One fetch
 * per source bounds request frequency. Returned in ranked order so the cascade tries the most
 * promising candidates first.
 */
export const selectWordLevelFallbacks = (args: {
    bestMatch: InternetProviderLyricSearchResponse;
    maxScore: number;
    ranked: InternetProviderLyricSearchResponse[];
}): InternetProviderLyricSearchResponse[] => {
    const { bestMatch, maxScore, ranked } = args;

    const seenSources = new Set<LyricSource>([bestMatch.source]);
    const fallbacks: InternetProviderLyricSearchResponse[] = [];

    for (const candidate of ranked) {
        if ((candidate.score ?? 1) > maxScore) {
            continue;
        }
        if (seenSources.has(candidate.source)) {
            continue;
        }
        seenSources.add(candidate.source);
        fallbacks.push(candidate);
    }

    return fallbacks;
};
