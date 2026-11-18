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

// Libraries frequently append a localized/translated title in parentheses. The wording
// differs per metadata source, so it pulls the fuzzy score below the match threshold. The
// translation may sit before a trailing feat credit, which is part of the real title and must
// survive the strip (and must never be stripped itself).
const TRAILING_PARENTHETICAL_PATTERN =
    /\s*[（(]([^（）()]*)[）)](\s*[（(](?:feat\.?|ft\.?|featuring)\b[^（）()]*[）)])?\s*$/i;
const FEATURING_PATTERN = /\b(?:featuring|feat|ft)\.?\s*[^\s）)]/i;

/**
 * Title variant with a parenthetical translation removed, for one retry of the match search.
 * A trailing feat credit is kept. Returns null when there is nothing to strip, the title would
 * become empty, or the parenthetical itself names featured artists.
 */
export const stripTrailingTranslation = (name: string): null | string => {
    const match = TRAILING_PARENTHETICAL_PATTERN.exec(name);

    if (!match || FEATURING_PATTERN.test(match[1])) {
        return null;
    }

    const stripped = (name.slice(0, match.index) + (match[2] ?? '')).trim();
    return stripped.length > 0 ? stripped : null;
};

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

// Library titles mix full-width and half-width punctuation across metadata sources; folding
// them keeps the fuzzy score from punishing a purely cosmetic difference.
const normalizeMatchText = (value: string): string =>
    value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

const PARENTHETICAL_PATTERN = /[（(][^（）()]*[）)]/g;
const NON_WORD_PATTERN = /[^\p{L}\p{N}]+/gu;

/** Title core without parentheticals (translations, feat credits) and punctuation. */
const coreTitle = (value: string): string =>
    normalizeMatchText(value).replace(PARENTHETICAL_PATTERN, '').replace(NON_WORD_PATTERN, '');

const artistTokens = (value: string): string[] =>
    normalizeMatchText(value)
        .split(/[,;/&、・•·]|\s+(?:feat\.?|ft\.?|with)\s+/)
        .map((token) => token.replace(NON_WORD_PATTERN, ''))
        .filter(Boolean);

/**
 * Trust-boundary gate: a remote candidate must actually be this song, not merely the least
 * bad fuzzy hit. Fuzzy scores alone accepted an unrelated track once provider search returned
 * nonsense for a mixed-language query, so acceptance also requires the same title core and a
 * shared artist credit. Missing artist metadata on either side falls back to the title check.
 */
export const isPlausibleMatch = (
    candidate: InternetProviderLyricSearchResponse,
    params: LyricSearchQuery,
): boolean => {
    const songCore = coreTitle(params.name ?? '');
    const candidateCore = coreTitle(candidate.name ?? '');
    if (!songCore || !candidateCore) return false;
    if (!songCore.includes(candidateCore) && !candidateCore.includes(songCore)) return false;

    const songArtists = artistTokens(params.artist ?? '');
    const candidateArtists = artistTokens(candidate.artist ?? '');
    if (!songArtists.length || !candidateArtists.length) return true;
    return songArtists.some((token) => candidateArtists.includes(token));
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
            { getFn: (song) => normalizeMatchText(song.name), name: 'name', weight: 2 },
            { getFn: (song) => normalizeMatchText(song.artist), name: 'artist', weight: 2 },
        ],
        threshold: 0.6,
    };

    const fuse = new Fuse(results, options);

    let searchResults: Array<FuseResult<InternetProviderLyricSearchResponse>>;

    if (params.artist && params.name) {
        const artistFuse = new Fuse(results, {
            includeScore: true,
            keys: [{ getFn: (song) => normalizeMatchText(song.artist), name: 'artist' }],
            threshold: 0.6,
        });

        const nameFuse = new Fuse(results, {
            includeScore: true,
            keys: [{ getFn: (song) => normalizeMatchText(song.name), name: 'name' }],
            threshold: 0.6,
        });

        const artistResults = artistFuse.search(normalizeMatchText(params.artist));
        const nameResults = nameFuse.search(normalizeMatchText(params.name));

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
            ...(params.artist && { artist: normalizeMatchText(params.artist) }),
            ...(params.name && { name: normalizeMatchText(params.name) }),
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
