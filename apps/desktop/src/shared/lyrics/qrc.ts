import { buildOverlayTrack, matchOverlayByTime } from './overlay';
import { parseQrcWords } from './qrc-words';
import { parseTimedTrackEntries } from './timed-track';
import { ParsedLyrics } from './types';

import { SynchronizedLyricLine, SynchronizedLyrics } from '/@/shared/types/domain-types';

const QRC_LINE = /^\[(\d+),(\d+)\](.*)$/;

const parseQrcLine = (
    lineStartMs: number,
    lineDurationMs: number,
    content: string,
): null | SynchronizedLyricLine => {
    const words = parseQrcWords(content);

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
 * Parse decrypted QQ Music QRC word-level lyrics. Word timestamps are absolute
 * milliseconds. Translation (trans) and romanization (roma) tracks are themselves
 * QRC and are aligned to the main lines by timestamp.
 */
export const parseQrc = (
    raw: string,
    translationRaw?: null | string,
    romanizationRaw?: null | string,
): ParsedLyrics => {
    const lines: SynchronizedLyrics = [];

    for (const rawLine of raw.replace(/^/, '').split(/\r?\n/)) {
        const match = QRC_LINE.exec(rawLine.trim());

        if (!match) {
            continue;
        }

        const line = parseQrcLine(parseInt(match[1], 10), parseInt(match[2], 10), match[3]);

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
