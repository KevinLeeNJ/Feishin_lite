import { describe, expect, it } from 'vitest';

import { parseYrc } from './yrc';

describe('parseYrc', () => {
    it('parses absolute millisecond word cues', () => {
        const { lines } = parseYrc('[1000,2000](1000,500,0)你(1500,500,0)好');

        expect(lines).toHaveLength(1);
        expect(lines[0].startMs).toBe(1000);
        expect(lines[0].text).toBe('你好');
        expect(lines[0].cueLines?.[0]).toEqual({
            endMs: 3000,
            index: 0,
            startMs: 1000,
            value: '你好',
            words: [
                { endMs: 1500, startMs: 1000, text: '你' },
                { endMs: 2000, startMs: 1500, text: '好' },
            ],
        });
    });

    it('keeps zero-duration words', () => {
        const { lines } = parseYrc('[0,1000](0,0,0)啊(0,1000,0)哦');

        expect(lines[0].cueLines?.[0].words[0]).toEqual({ endMs: 0, startMs: 0, text: '啊' });
    });

    it('sorts out-of-order lines and skips metadata', () => {
        const { lines } = parseYrc(
            '[channel:0]\n[2000,1000](2000,1000,0)b\n[1000,1000](1000,1000,0)a',
        );

        expect(lines.map((line) => line.text)).toEqual(['a', 'b']);
    });

    it('aligns a tlyric translation track', () => {
        const { translation } = parseYrc('[1000,1000](1000,1000,0)hello', '[00:01.00]你好');

        expect(translation).toEqual([{ startMs: 1000, text: '你好' }]);
    });

    it('preserves utf-8 and emoji word text', () => {
        const { lines } = parseYrc('[0,1000](0,1000,0)🎵歌');

        expect(lines[0].text).toBe('🎵歌');
    });
});
