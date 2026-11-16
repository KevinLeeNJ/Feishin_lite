import { describe, expect, it } from 'vitest';

import { orderSearchResults, selectWordLevelFallbacks } from './shared';

import {
    InternetProviderLyricSearchResponse,
    LyricSearchQuery,
    LyricSource,
} from '/@/shared/types/domain-types';

const candidate = (
    overrides: Partial<InternetProviderLyricSearchResponse> = {},
): InternetProviderLyricSearchResponse => ({
    artist: 'Jay Chou',
    id: 'base',
    isSync: null,
    name: 'Dao Xiang',
    source: LyricSource.NETEASE,
    ...overrides,
});

const params: LyricSearchQuery = { artist: 'Jay Chou', duration: 240, name: 'Dao Xiang' };

describe('orderSearchResults duration-aware ranking', () => {
    it('ranks the candidate whose duration matches the real song first', () => {
        const ranked = orderSearchResults({
            params,
            results: [
                candidate({ duration: 400, id: 'far' }),
                candidate({ duration: 240, id: 'near' }),
            ],
        });

        expect(ranked[0].id).toBe('near');
        expect(ranked[0].score).toBeLessThan(ranked[1].score ?? Infinity);
    });

    it('ignores duration gaps within the tolerance', () => {
        const ranked = orderSearchResults({
            params,
            results: [candidate({ duration: 242, id: 'a' })],
        });

        expect(ranked[0].score).toBeCloseTo(0, 5);
    });

    it('treats unknown candidate duration as neutral (no penalty)', () => {
        const ranked = orderSearchResults({
            params,
            results: [candidate({ duration: undefined, id: 'a' })],
        });

        expect(ranked[0].score).toBeCloseTo(0, 5);
    });

    it('adds a capped penalty for a clearly wrong-length version', () => {
        const near = orderSearchResults({
            params,
            results: [candidate({ duration: 240, id: 'n' })],
        })[0].score;
        const far = orderSearchResults({
            params,
            results: [candidate({ duration: 400, id: 'f' })],
        })[0].score;

        expect(far).toBeGreaterThan(near ?? 0);
        expect(far).toBeCloseTo(0.5, 5);
    });

    it('steeply penalizes a moderately wrong-length version', () => {
        // 30s off on a 240s song: (30 - 3) / 240 * 3 = 0.3375, well above the old gentle slope.
        const ranked = orderSearchResults({
            params,
            results: [candidate({ duration: 270, id: 'live' })],
        });

        expect(ranked[0].score).toBeCloseTo(0.3375, 4);
    });

    it('still prefers a confirmed synced candidate over an unknown one', () => {
        const ranked = orderSearchResults({
            params,
            results: [
                candidate({ id: 'plain', isSync: null }),
                candidate({ id: 'synced', isSync: true }),
            ],
        });

        expect(ranked[0].id).toBe('synced');
    });
});

describe('selectWordLevelFallbacks', () => {
    const best = candidate({ id: 'best', score: 0.1, source: LyricSource.NETEASE });

    it('excludes the best source and keeps only one candidate per source', () => {
        const ranked = [
            best,
            candidate({ id: 'netease2', score: 0.2, source: LyricSource.NETEASE }),
            candidate({ id: 'qq1', score: 0.15, source: LyricSource.QQMUSIC }),
            candidate({ id: 'qq2', score: 0.3, source: LyricSource.QQMUSIC }),
            candidate({ id: 'kugou1', score: 0.2, source: LyricSource.KUGOU }),
        ];

        const fallbacks = selectWordLevelFallbacks({ bestMatch: best, maxScore: 0.55, ranked });

        expect(fallbacks.map((f) => f.id)).toEqual(['qq1', 'kugou1']);
    });

    it('drops candidates whose score exceeds the acceptance threshold', () => {
        const ranked = [
            best,
            candidate({ id: 'tooFar', score: 0.6, source: LyricSource.QQMUSIC }),
            candidate({ id: 'ok', score: 0.5, source: LyricSource.KUGOU }),
        ];

        const fallbacks = selectWordLevelFallbacks({ bestMatch: best, maxScore: 0.55, ranked });

        expect(fallbacks.map((f) => f.id)).toEqual(['ok']);
    });

    it('preserves the incoming ranked order rather than re-sorting by score', () => {
        const ranked = [
            best,
            candidate({ id: 'kugou', score: 0.4, source: LyricSource.KUGOU }),
            candidate({ id: 'qq', score: 0.2, source: LyricSource.QQMUSIC }),
        ];

        const fallbacks = selectWordLevelFallbacks({ bestMatch: best, maxScore: 0.55, ranked });

        expect(fallbacks.map((f) => f.id)).toEqual(['kugou', 'qq']);
    });

    it('returns empty when every candidate shares the best source', () => {
        const ranked = [
            best,
            candidate({ id: 'netease2', score: 0.2, source: LyricSource.NETEASE }),
        ];

        const fallbacks = selectWordLevelFallbacks({ bestMatch: best, maxScore: 0.55, ranked });

        expect(fallbacks).toEqual([]);
    });
});
