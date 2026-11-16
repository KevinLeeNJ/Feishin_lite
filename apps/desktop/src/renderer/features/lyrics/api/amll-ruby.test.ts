import { describe, expect, it } from 'vitest';

import { parseRubySegments, rubyTextToWords } from './amll-ruby';

describe('parseRubySegments', () => {
    it('returns plain text as a single segment', () => {
        expect(parseRubySegments('hello')).toEqual([{ base: 'hello' }]);
    });

    it('returns empty for empty text', () => {
        expect(parseRubySegments('')).toEqual([]);
    });

    it('parses kuroshiro furigana HTML with rp fallback parens', () => {
        expect(parseRubySegments('<ruby>漢<rp>(</rp><rt>かん</rt><rp>)</rp></ruby>')).toEqual([
            { base: '漢', reading: 'かん' },
        ]);
    });

    it('splits mixed plain runs and multiple ruby blocks', () => {
        const text = '私<ruby>漢<rp>(</rp><rt>かん</rt><rp>)</rp></ruby>字';
        expect(parseRubySegments(text)).toEqual([
            { base: '私' },
            { base: '漢', reading: 'かん' },
            { base: '字' },
        ]);
    });
});

describe('rubyTextToWords', () => {
    it('maps a plain word to one AMLL word', () => {
        expect(rubyTextToWords({ endMs: 2000, startMs: 1000, text: 'ok' })).toEqual([
            { endTime: 2000, startTime: 1000, word: 'ok' },
        ]);
    });

    it('maps a single ruby word to structured ruby', () => {
        const words = rubyTextToWords({
            endMs: 2000,
            startMs: 1000,
            text: '<ruby>漢<rp>(</rp><rt>かん</rt><rp>)</rp></ruby>',
        });
        expect(words).toEqual([
            {
                endTime: 2000,
                ruby: [{ endTime: 2000, startTime: 1000, word: 'かん' }],
                startTime: 1000,
                word: '漢',
            },
        ]);
    });

    it('distributes time across mixed segments proportionally to base length', () => {
        const words = rubyTextToWords({
            endMs: 4000,
            startMs: 1000,
            text: 'a<ruby>漢<rp>(</rp><rt>かん</rt><rp>)</rp></ruby>',
        });
        expect(words).toHaveLength(2);
        expect(words[0].word).toBe('a');
        expect(words[1].word).toBe('漢');
        expect(words[1].ruby?.[0].word).toBe('かん');
        // Two base chars over 3000ms: 1500ms each, contiguous and covering the span.
        expect(words[0].startTime).toBe(1000);
        expect(words[0].endTime).toBe(2500);
        expect(words[1].startTime).toBe(2500);
        expect(words[1].endTime).toBe(4000);
    });

    it('keeps zero-duration words', () => {
        const words = rubyTextToWords({ endMs: 1000, startMs: 1000, text: 'x' });
        expect(words).toEqual([{ endTime: 1000, startTime: 1000, word: 'x' }]);
    });
});
