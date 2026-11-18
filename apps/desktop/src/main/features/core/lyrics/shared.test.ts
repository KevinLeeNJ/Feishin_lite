import { describe, expect, it } from 'vitest';

import {
    isPlausibleMatch,
    orderSearchResults,
    selectWordLevelFallbacks,
    stripTrailingTranslation,
} from './shared';

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

    it('does not inflate the score for full-width vs half-width punctuation', () => {
        const fullWidth: LyricSearchQuery = {
            artist: '可不',
            duration: 168,
            name: "充分だよ。（That's Enough）",
        };
        const ranked = orderSearchResults({
            params: fullWidth,
            results: [
                candidate({
                    artist: '可不',
                    duration: 168,
                    id: 'half',
                    name: "充分だよ。(That's Enough)",
                }),
            ],
        });

        expect(ranked[0].score).toBeLessThanOrEqual(0.55);
    });
});

describe('isPlausibleMatch', () => {
    const song: LyricSearchQuery = { artist: '可不', duration: 168, name: '夜曲（安静）' };

    it('accepts a candidate whose core title is contained and shares an artist token', () => {
        expect(isPlausibleMatch(candidate({ artist: '可不', name: '夜曲' }), song)).toBe(true);
    });

    it('rejects an unrelated title even when the artist matches', () => {
        expect(isPlausibleMatch(candidate({ artist: '可不', name: '循迹' }), song)).toBe(false);
    });

    it('rejects a matching title whose artists share no token', () => {
        expect(isPlausibleMatch(candidate({ artist: '王子健', name: '夜曲' }), song)).toBe(false);
    });

    it('matches a featured artist listed among multiple candidate artists', () => {
        const featSong = { ...song, artist: 'MIMI feat. 可不' };
        expect(isPlausibleMatch(candidate({ artist: '可不, MIMI', name: '夜曲' }), featSong)).toBe(
            true,
        );
    });

    it('accepts on title alone when either side lists no artist', () => {
        expect(isPlausibleMatch(candidate({ artist: '', name: '夜曲' }), song)).toBe(true);
        expect(isPlausibleMatch(candidate({ name: '夜曲' }), { ...song, artist: '' })).toBe(true);
    });

    it('rejects when either core title is empty', () => {
        expect(isPlausibleMatch(candidate({ name: '（）' }), song)).toBe(false);
        expect(isPlausibleMatch(candidate({ name: '夜曲' }), { ...song, name: '' })).toBe(false);
    });
});

describe('stripTrailingTranslation', () => {
    it('removes a trailing full-width parenthetical translation', () => {
        expect(stripTrailingTranslation('夜曲（安静）')).toBe('夜曲');
    });

    it('removes a trailing half-width parenthetical with spacing', () => {
        expect(stripTrailingTranslation('Lemon (Remix Version)')).toBe('Lemon');
    });

    it('keeps only one trailing parenthetical per retry', () => {
        expect(stripTrailingTranslation('Song (Live) (Acoustic)')).toBe('Song (Live)');
    });

    it('ignores parentheticals that name featured artists', () => {
        expect(stripTrailingTranslation('Song (feat. Jay Chou)')).toBeNull();
        expect(stripTrailingTranslation('歌曲（feat.周杰伦）')).toBeNull();
        expect(stripTrailingTranslation('Song (ft. A)')).toBeNull();
        expect(stripTrailingTranslation('Song (Featuring A)')).toBeNull();
    });

    it('ignores titles without a usable trailing parenthetical', () => {
        expect(stripTrailingTranslation('晴天')).toBeNull();
        expect(stripTrailingTranslation('晴天 (Live)')).toBe('晴天');
        expect(stripTrailingTranslation('（纯音乐）')).toBeNull();
        expect(stripTrailingTranslation('Song (unclosed')).toBeNull();
    });

    it('strips a translation that sits before a trailing feat credit', () => {
        expect(stripTrailingTranslation("それで充分だよ。（That's Enough） (feat. 可不)")).toBe(
            'それで充分だよ。 (feat. 可不)',
        );
        expect(stripTrailingTranslation('Song (Live) (feat. A)')).toBe('Song (feat. A)');
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
