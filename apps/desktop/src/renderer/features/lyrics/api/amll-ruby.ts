import type { LyricWord } from '@applemusic-like-lyrics/core';

import { SyncedWordCue } from '/@/shared/types/domain-types';

const RUBY_BLOCK_RE = /<ruby>([\s\S]*?)<\/ruby>/g;
const RT_RE = /<rt>([\s\S]*?)<\/rt>/;
const RP_RE = /<rp>[\s\S]*?<\/rp>/g;
const TAG_RE = /<[^>]+>/g;

interface RubySegment {
    base: string;
    reading?: string;
}

const stripTags = (value: string): string => value.replace(TAG_RE, '');

/**
 * Split kuroshiro furigana HTML into plain runs and ruby annotations.
 * Kuroshiro emits `<ruby>base<rp>(</rp><rt>reading</rt><rp>)</rp></ruby>` per
 * notation, with plain text between blocks. AMLL renders ruby structurally, so
 * the HTML must be decomposed rather than passed through as word text.
 */
export const parseRubySegments = (text: string): RubySegment[] => {
    if (!text.includes('<ruby')) {
        return text.length > 0 ? [{ base: text }] : [];
    }

    const segments: RubySegment[] = [];
    let lastIndex = 0;

    for (const match of text.matchAll(RUBY_BLOCK_RE)) {
        const before = text.slice(lastIndex, match.index);
        if (before.length > 0) {
            segments.push({ base: before });
        }

        const inner = match[1];
        const reading = inner.match(RT_RE)?.[1];
        const base = stripTags(inner.replace(RT_RE, '').replace(RP_RE, ''));
        segments.push({ base, reading: reading ? stripTags(reading) : undefined });
        lastIndex = (match.index ?? 0) + match[0].length;
    }

    const tail = text.slice(lastIndex);
    if (tail.length > 0) {
        segments.push({ base: tail });
    }

    return segments;
};

/**
 * Convert one timed word into AMLL words. Plain text yields a single word; a
 * furigana-annotated word yields one AMLL word per segment with structured ruby,
 * sharing the parent word's time span proportionally to base character count.
 */
export const rubyTextToWords = (word: SyncedWordCue): LyricWord[] => {
    const segments = parseRubySegments(word.text);

    if (segments.length === 0) {
        return [{ endTime: word.endMs, startTime: word.startMs, word: '' }];
    }

    if (segments.length === 1) {
        const only = segments[0];
        const single: LyricWord = {
            endTime: word.endMs,
            startTime: word.startMs,
            word: only.base,
        };
        if (only.reading) {
            single.ruby = [{ endTime: word.endMs, startTime: word.startMs, word: only.reading }];
        }
        return [single];
    }

    const totalChars = segments.reduce((sum, seg) => sum + Math.max(1, seg.base.length), 0);
    const duration = word.endMs - word.startMs;
    let cursor = word.startMs;

    return segments.map((seg, index) => {
        const isLast = index === segments.length - 1;
        const endTime = isLast
            ? word.endMs
            : cursor + duration * (Math.max(1, seg.base.length) / totalChars);
        const lyricWord: LyricWord = { endTime, startTime: cursor, word: seg.base };
        if (seg.reading) {
            lyricWord.ruby = [{ endTime, startTime: cursor, word: seg.reading }];
        }
        cursor = endTime;
        return lyricWord;
    });
};
