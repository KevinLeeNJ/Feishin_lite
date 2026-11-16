import { describe, expect, it } from 'vitest';

import { lineText, samples, toLrc, toQrc, toYrc } from './lyric-fixtures';
import { buildProviderResult } from './result';

import { ParsedLyrics, parseLrc, parseQrc, parseYrc } from '/@/shared/lyrics';
import { LyricSource, LyricsSourceFormat } from '/@/shared/types/domain-types';

const classify = (parsed: ParsedLyrics, source: LyricSource, sourceFormat: LyricsSourceFormat) =>
    buildProviderResult({
        artist: '',
        name: '',
        parsed,
        rawText: '',
        remoteId: 'fixture',
        source,
        sourceFormat,
    });

describe('granularity matrix across providers and languages', () => {
    for (const lang of ['cn', 'en', 'jp'] as const) {
        it(`QRC ${lang} main is word-level`, () => {
            const result = classify(parseQrc(toQrc(samples[lang])), LyricSource.QQMUSIC, 'qrc');

            expect(result.lyrics.timingGranularity).toBe('word');
            expect(result.lyrics.lyrics).toHaveLength(2);
        });

        it(`YRC ${lang} main is word-level`, () => {
            const result = classify(parseYrc(toYrc(samples[lang])), LyricSource.NETEASE, 'yrc');

            expect(result.lyrics.timingGranularity).toBe('word');
            expect(result.lyrics.lyrics).toHaveLength(2);
        });

        it(`LRC ${lang} main is line-level`, () => {
            const result = classify(parseLrc(toLrc(samples[lang])), LyricSource.NETEASE, 'lrc');

            expect(result.lyrics.timingGranularity).toBe('line');
            expect(result.lyrics.lyrics).toHaveLength(2);
        });
    }

    it('plain text has undefined granularity and preserves the raw text', () => {
        const result = buildProviderResult({
            artist: '',
            name: '',
            parsed: parseLrc('just plain text'),
            rawText: 'just plain text',
            remoteId: 'fixture',
            source: LyricSource.QQMUSIC,
            sourceFormat: 'text',
        });

        expect(result.lyrics.timingGranularity).toBeUndefined();
        expect(result.lyrics.lyrics).toBe('just plain text');
    });
});

describe('line-level translation never downgrades a word-level main', () => {
    for (const lang of ['cn', 'en', 'jp'] as const) {
        it(`QRC ${lang} main + LRC translation stays word-level with aligned translation`, () => {
            const parsed = parseQrc(toQrc(samples[lang]), toLrc(samples[lang]), null);
            const result = classify(parsed, LyricSource.QQMUSIC, 'qrc');

            expect(result.lyrics.timingGranularity).toBe('word');
            expect(result.translation).not.toBeNull();
            expect(result.translation).toHaveLength(2);
            expect(result.translation?.[0].text).toBe(lineText(samples[lang][0]));
        });
    }
});
