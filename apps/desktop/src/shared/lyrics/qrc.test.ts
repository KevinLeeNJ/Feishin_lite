import { describe, expect, it } from 'vitest';

import { parseQrc } from './qrc';

describe('parseQrc', () => {
    it('reads trailing word text with absolute timestamps', () => {
        const { lines } = parseQrc('[1000,2000](1000,500)你(1500,500)好');

        expect(lines[0].text).toBe('你好');
        expect(lines[0].cueLines?.[0].words).toEqual([
            { endMs: 1500, startMs: 1000, text: '你' },
            { endMs: 2000, startMs: 1500, text: '好' },
        ]);
    });

    it('reads leading word text when the exporter puts text before tags', () => {
        const { lines } = parseQrc('[1000,2000]你(1000,500)好(1500,500)');

        expect(lines[0].text).toBe('你好');
        expect(lines[0].cueLines?.[0].words).toEqual([
            { endMs: 1500, startMs: 1000, text: '你' },
            { endMs: 2000, startMs: 1500, text: '好' },
        ]);
    });

    it('accepts an optional third flag field in word tags', () => {
        const { lines } = parseQrc('[0,1000](0,1000,0)word');

        expect(lines[0].cueLines?.[0].words).toEqual([{ endMs: 1000, startMs: 0, text: 'word' }]);
    });

    it('aligns a QRC translation track', () => {
        const { translation } = parseQrc(
            '[1000,1000](1000,1000)hello',
            '[1000,1000](1000,1000)你好',
        );

        expect(translation).toEqual([{ startMs: 1000, text: '你好' }]);
    });

    it('skips lines without word tags', () => {
        const { lines } = parseQrc('[ti:title]\n[0,1000]plain text without tags');

        expect(lines).toHaveLength(0);
    });
});
