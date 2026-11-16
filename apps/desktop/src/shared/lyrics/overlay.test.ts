import { describe, expect, it } from 'vitest';

import { matchOverlayByTime } from './overlay';

describe('matchOverlayByTime', () => {
    it('gives two lines starting together distinct entries (duet)', () => {
        const lines = [
            { startMs: 1000, text: 'a' },
            { startMs: 1000, text: 'b' },
        ];
        const entries = [
            { startMs: 1000, text: 'A' },
            { startMs: 1000, text: 'B' },
        ];

        expect(matchOverlayByTime(lines, entries)).toEqual(['A', 'B']);
    });

    it('does not let a line borrow a neighbour entry already claimed', () => {
        const lines = [
            { startMs: 0, text: 'a' },
            { startMs: 500, text: 'b' },
        ];
        const entries = [{ startMs: 0, text: 'only' }];

        expect(matchOverlayByTime(lines, entries)).toEqual(['only', null]);
    });

    it('prefers the closest entry within the window', () => {
        const lines = [{ startMs: 1000, text: 'a' }];
        const entries = [
            { startMs: 1800, text: 'far' },
            { startMs: 1100, text: 'near' },
        ];

        expect(matchOverlayByTime(lines, entries)).toEqual(['near']);
    });

    it('rejects entries outside the strict one second window', () => {
        const lines = [{ startMs: 0, text: 'a' }];
        const entries = [{ startMs: 1000, text: 'edge' }];

        expect(matchOverlayByTime(lines, entries)).toEqual([null]);
    });

    it('returns all null for empty inputs', () => {
        expect(matchOverlayByTime([], [{ startMs: 0, text: 'x' }])).toEqual([]);
        expect(matchOverlayByTime([{ startMs: 0, text: 'a' }], [])).toEqual([null]);
    });
});
