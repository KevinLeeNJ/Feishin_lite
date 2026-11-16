import { describe, expect, it } from 'vitest';

import { toAmllLyrics } from './to-amll-lyrics';

import { SynchronizedLyrics } from '/@/shared/types/domain-types';

const LAST_LINE_END_MS = 999 * 60 * 1000;

describe('toAmllLyrics', () => {
    it('maps plain LRC to single-word line-level lines (no fake karaoke)', () => {
        const lyrics: SynchronizedLyrics = [
            { startMs: 1000, text: 'first' },
            { startMs: 5000, text: 'second' },
        ];

        const result = toAmllLyrics({ lyrics });

        expect(result).toHaveLength(2);
        expect(result[0].words).toEqual([{ endTime: 5000, startTime: 1000, word: 'first' }]);
        expect(result[0].startTime).toBe(1000);
        expect(result[0].endTime).toBe(5000);
        expect(result[0].isBG).toBe(false);
        expect(result[0].isDuet).toBe(false);
        // AMLL treats a single word whose start equals the line start as line-level.
        expect(result[0].words[0].startTime).toBe(result[0].startTime);
        // Final line uses AMLL's LRC sentinel.
        expect(result[1].endTime).toBe(LAST_LINE_END_MS);
        expect(result[1].words[0].endTime).toBe(LAST_LINE_END_MS);
    });

    it('preserves word-level cue timings', () => {
        const lyrics: SynchronizedLyrics = [
            {
                cueLines: [
                    {
                        endMs: 4000,
                        index: 0,
                        startMs: 1000,
                        value: '逐字',
                        words: [
                            { endMs: 1800, startMs: 1000, text: '逐' },
                            { endMs: 4000, startMs: 1800, text: '字' },
                        ],
                    },
                ],
                startMs: 1000,
                text: '逐字',
            },
        ];

        const result = toAmllLyrics({ lyrics });

        expect(result[0].words).toEqual([
            { endTime: 1800, startTime: 1000, word: '逐' },
            { endTime: 4000, startTime: 1800, word: '字' },
        ]);
        expect(result[0].endTime).toBe(4000);
    });

    it('attaches translation and romanization overlays by time', () => {
        const lyrics: SynchronizedLyrics = [
            { startMs: 1000, text: 'hello' },
            { startMs: 5000, text: 'world' },
        ];

        const result = toAmllLyrics({
            lyrics,
            romanization: [{ startMs: 1000, text: 'he-lo' }],
            translation: [{ startMs: 5000, text: '世界' }],
        });

        expect(result[0].translatedLyric).toBe('');
        expect(result[0].romanLyric).toBe('he-lo');
        expect(result[1].translatedLyric).toBe('世界');
        // Overlay matching reuses findOverlayLineByTime: a line without its own
        // entry inherits the latest preceding one (same as the legacy renderer).
        expect(result[1].romanLyric).toBe('he-lo');
    });

    it('maps word-level romaji to romanWord by cue/word index', () => {
        const lyrics: SynchronizedLyrics = [
            {
                cueLines: [
                    {
                        endMs: 4000,
                        index: 0,
                        startMs: 1000,
                        value: '漢字',
                        words: [
                            { endMs: 2000, startMs: 1000, text: '漢' },
                            { endMs: 4000, startMs: 2000, text: '字' },
                        ],
                    },
                ],
                startMs: 1000,
                text: '漢字',
            },
        ];

        const result = toAmllLyrics({
            lyrics,
            wordRomanization: [
                [
                    {
                        endMs: 4000,
                        index: 0,
                        startMs: 1000,
                        value: 'kanji',
                        words: [
                            { endMs: 2000, startMs: 1000, text: 'kan' },
                            { endMs: 4000, startMs: 2000, text: 'ji' },
                        ],
                    },
                ],
            ],
        });

        expect(result[0].words[0].romanWord).toBe('kan');
        expect(result[0].words[1].romanWord).toBe('ji');
    });

    it('emits background vocals as a separate isBG line', () => {
        const lyrics: SynchronizedLyrics = [
            {
                cueLines: [
                    {
                        agentId: 'lead',
                        endMs: 3000,
                        index: 0,
                        startMs: 1000,
                        value: 'main',
                        words: [{ endMs: 3000, startMs: 1000, text: 'main' }],
                    },
                    {
                        agentId: 'bg',
                        endMs: 3000,
                        index: 0,
                        startMs: 1500,
                        value: 'echo',
                        words: [{ endMs: 3000, startMs: 1500, text: 'echo' }],
                    },
                ],
                startMs: 1000,
                text: 'main echo',
            },
        ];

        const result = toAmllLyrics({
            agents: [
                { id: 'lead', role: 'main' },
                { id: 'bg', role: 'bg' },
            ],
            lyrics,
        });

        expect(result).toHaveLength(2);
        expect(result[0].isBG).toBe(false);
        expect(result[0].words.map((w) => w.word)).toEqual(['main']);
        expect(result[1].isBG).toBe(true);
        expect(result[1].startTime).toBe(1500);
        expect(result[1].words.map((w) => w.word)).toEqual(['echo']);
    });

    it('right-aligns secondary lead agent lines as duet', () => {
        const lyrics: SynchronizedLyrics = [
            {
                cueLines: [
                    { agentId: 'a', endMs: 2000, index: 0, startMs: 1000, value: 'a', words: [] },
                ],
                startMs: 1000,
                text: 'a',
            },
            {
                cueLines: [
                    { agentId: 'b', endMs: 4000, index: 1, startMs: 3000, value: 'b', words: [] },
                ],
                startMs: 3000,
                text: 'b',
            },
        ];

        const result = toAmllLyrics({
            agents: [
                { id: 'a', role: 'main' },
                { id: 'b', role: 'voice' },
            ],
            lyrics,
        });

        expect(result[0].isDuet).toBe(false);
        expect(result[1].isDuet).toBe(true);
    });

    it('handles zero-duration and emoji words without dropping them', () => {
        const lyrics: SynchronizedLyrics = [
            {
                cueLines: [
                    {
                        endMs: 2000,
                        index: 0,
                        startMs: 1000,
                        value: '🎵ok',
                        words: [
                            { endMs: 1000, startMs: 1000, text: '🎵' },
                            { endMs: 2000, startMs: 1000, text: 'ok' },
                        ],
                    },
                ],
                startMs: 1000,
                text: '🎵ok',
            },
        ];

        const result = toAmllLyrics({ lyrics });

        expect(result[0].words.map((w) => w.word)).toEqual(['🎵', 'ok']);
        expect(result[0].words[0].endTime).toBe(1000);
    });

    it('returns an empty array for empty lyrics', () => {
        expect(toAmllLyrics({ lyrics: [] })).toEqual([]);
    });

    it('sorts out-of-order lines and never emits endTime before startTime', () => {
        // Repro of the Moonlight crash: a late line precedes an early one in the
        // source array, so the naive next-line end boundary fell before the start
        // and AMLL threw "startTime is greater than endTime".
        const lyrics: SynchronizedLyrics = [
            { startMs: 237100, text: 'late' },
            { startMs: 38500, text: 'early' },
            { startMs: 100000, text: 'mid' },
        ];

        const result = toAmllLyrics({ lyrics });

        expect(result.map((line) => line.startTime)).toEqual([38500, 100000, 237100]);
        for (const line of result) {
            expect(line.endTime).toBeGreaterThanOrEqual(line.startTime);
        }
        expect(result[0].endTime).toBe(100000);
        expect(result[1].endTime).toBe(237100);
        expect(result[2].endTime).toBe(LAST_LINE_END_MS);
    });
});
