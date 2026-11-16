import { buildOverlayTrack, matchOverlayByTime } from './overlay';
import { parseTimedTrackEntries } from './timed-track';
import { ParsedLyrics } from './types';

import { SynchronizedLyricLine, SynchronizedLyrics } from '/@/shared/types/domain-types';

const YRC_LINE = /^\[(\d+),(\d+)\](.*)$/;
const YRC_WORD = /\((\d+),(\d+),(\d+)\)([^()]*)/g;

const parseYrcLine = (
    lineStartMs: number,
    lineDurationMs: number,
    content: string,
): null | SynchronizedLyricLine => {
    const words = [...content.matchAll(YRC_WORD)].map((match) => {
        const startMs = parseInt(match[1], 10);
        const durationMs = parseInt(match[2], 10);

        return {
            endMs: startMs + durationMs,
            startMs,
            text: match[4],
        };
    });

    if (words.length === 0) {
        return null;
    }

    const text = words.map((word) => word.text).join('');

    return {
        cueLines: [
            {
                endMs: lineStartMs + lineDurationMs,
                index: 0,
                startMs: lineStartMs,
                value: text,
                words,
            },
        ],
        startMs: lineStartMs,
        text,
    };
};

/**
 * Parse NetEase YRC word-level lyrics. Word timestamps are absolute milliseconds.
 * Optional translation (tlyric) and romanization tracks are aligned by timestamp.
 */
export const parseYrc = (
    raw: string,
    translationRaw?: null | string,
    romanizationRaw?: null | string,
): ParsedLyrics => {
    const lines: SynchronizedLyrics = [];

    for (const rawLine of raw.replace(/^/, '').split(/\r?\n/)) {
        const match = YRC_LINE.exec(rawLine.trim());

        if (!match) {
            continue;
        }

        const line = parseYrcLine(parseInt(match[1], 10), parseInt(match[2], 10), match[3]);

        if (line) {
            lines.push(line);
        }
    }

    lines.sort((a, b) => a.startMs - b.startMs);

    const translation = translationRaw
        ? buildOverlayTrack(
              lines,
              matchOverlayByTime(lines, parseTimedTrackEntries(translationRaw)),
          )
        : null;

    const romanization = romanizationRaw
        ? buildOverlayTrack(
              lines,
              matchOverlayByTime(lines, parseTimedTrackEntries(romanizationRaw)),
          )
        : null;

    return { lines, romanization, translation };
};
