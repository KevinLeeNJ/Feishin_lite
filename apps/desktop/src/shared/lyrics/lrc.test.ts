import { describe, expect, it } from 'vitest';

import { parseLrc } from './lrc';

describe('parseLrc', () => {
    it('parses line timestamps into milliseconds', () => {
        const { lines } = parseLrc('[00:01.50]first\n[00:02.00]second');

        expect(lines).toEqual([
            { startMs: 1500, text: 'first' },
            { startMs: 2000, text: 'second' },
        ]);
    });

    it('expands multiple time tags on one line and sorts them', () => {
        const { lines } = parseLrc('[00:03.00][00:01.00]chorus');

        expect(lines).toEqual([
            { startMs: 1000, text: 'chorus' },
            { startMs: 3000, text: 'chorus' },
        ]);
    });

    it('skips metadata tags and blank lines', () => {
        const { lines } = parseLrc('[ar:artist]\n[ti:title]\n[offset:500]\n\n[00:00.00]go');

        expect(lines).toEqual([{ startMs: 0, text: 'go' }]);
    });

    it('treats a three digit fraction as milliseconds', () => {
        const { lines } = parseLrc('[00:01.050]x');

        expect(lines[0].startMs).toBe(1050);
    });

    it('aligns a translation track by timestamp', () => {
        const { translation } = parseLrc(
            '[00:01.00]hello\n[00:05.00]world',
            '[00:01.00]你好\n[00:05.00]世界',
        );

        expect(translation).toEqual([
            { startMs: 1000, text: '你好' },
            { startMs: 5000, text: '世界' },
        ]);
    });

    it('returns null translation when no track matches', () => {
        const { translation } = parseLrc('[00:01.00]hello', '[00:30.00]far away');

        expect(translation).toBeNull();
    });
});
