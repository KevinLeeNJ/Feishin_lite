import { describe, expect, it } from 'vitest';

import { parseKrc } from './krc';

const languageTag = (content: unknown): string =>
    `[language:${Buffer.from(JSON.stringify(content)).toString('base64')}]`;

describe('parseKrc', () => {
    it('resolves word offsets relative to the line start', () => {
        const { lines } = parseKrc('[5000,2000]<1000,500>x<1500,500>y');

        expect(lines[0].startMs).toBe(5000);
        expect(lines[0].cueLines?.[0].words).toEqual([
            { endMs: 6500, startMs: 6000, text: 'x' },
            { endMs: 7000, startMs: 6500, text: 'y' },
        ]);
    });

    it('decodes embedded translation (type 1) and romanization (type 0) by index', () => {
        const raw = [
            '[0,1000]<0,500>你<500,500>好',
            '[1000,1000]<0,500>世<500,500>界',
            languageTag({
                content: [
                    { lyricContent: [['你好译文'], ['世界译文']], type: 1 },
                    {
                        lyricContent: [
                            ['ni', 'hao'],
                            ['shi', 'jie'],
                        ],
                        type: 0,
                    },
                ],
            }),
        ].join('\n');

        const { lines, romanization, translation } = parseKrc(raw);

        expect(lines.map((line) => line.text)).toEqual(['你好', '世界']);
        expect(translation).toEqual([
            { startMs: 0, text: '你好译文' },
            { startMs: 1000, text: '世界译文' },
        ]);
        expect(romanization).toEqual([
            { startMs: 0, text: 'nihao' },
            { startMs: 1000, text: 'shijie' },
        ]);
    });

    it('falls back to a line-level entry when a line has no word tags', () => {
        const { lines } = parseKrc('[0,1000]plain text');

        expect(lines).toEqual([{ startMs: 0, text: 'plain text' }]);
    });

    it('aligns an external translation track when no language section exists', () => {
        const { translation } = parseKrc('[0,1000]<0,1000>hello', '[00:00.00]你好');

        expect(translation).toEqual([{ startMs: 0, text: '你好' }]);
    });

    it('ignores a corrupt language section without throwing', () => {
        const { lines, translation } = parseKrc('[0,1000]<0,1000>x\n[language:not-base64!!]');

        expect(lines).toHaveLength(1);
        expect(translation).toBeNull();
    });
});
