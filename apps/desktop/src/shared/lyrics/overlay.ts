import { TimedTextEntry } from './types';

import { SynchronizedLyricLine, SynchronizedLyrics } from '/@/shared/types/domain-types';

const LRC_TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?]/g;

/** Convert an LRC minute/second/fraction tag to milliseconds. */
export const lrcTagToMs = (minutes: string, seconds: string, fraction?: string): number => {
    const fractionMs = fraction ? Math.round(parseFloat(`0.${fraction}`) * 1000) : 0;

    return (parseInt(minutes, 10) * 60 + parseInt(seconds, 10)) * 1000 + fractionMs;
};

/**
 * Parse a plain LRC string into timed text entries. Multiple time tags on one line
 * produce one entry per tag. Metadata tags such as [ar:...] and [offset:...] are
 * skipped because they do not match the numeric time pattern.
 */
export const parseLrcEntries = (raw: string): TimedTextEntry[] => {
    const entries: TimedTextEntry[] = [];

    for (const rawLine of raw.replace(/^/, '').split(/\r?\n/)) {
        const line = rawLine.trim();
        const tags = [...line.matchAll(LRC_TIME_TAG)];

        if (tags.length === 0) {
            continue;
        }

        const text = line.replace(LRC_TIME_TAG, '').trim();

        if (text.length === 0) {
            continue;
        }

        for (const tag of tags) {
            entries.push({
                startMs: lrcTagToMs(tag[1], tag[2], tag[3]),
                text,
            });
        }
    }

    return entries.sort((a, b) => a.startMs - b.startMs);
};

const OVERLAY_MATCH_WINDOW_MS = 1000;

/** First index whose startMs is >= timeMs; entries must be sorted by startMs. */
const lowerBoundByStartMs = (entries: TimedTextEntry[], timeMs: number): number => {
    let low = 0;
    let high = entries.length;

    while (low < high) {
        const middle = (low + high) >> 1;

        if (entries[middle].startMs < timeMs) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }

    return low;
};

/**
 * Pair each main line with the overlay entry that belongs to it (Folia's rule).
 * All candidate pairs within a strict +/-1s window are ranked by time difference and
 * taken greedily, so each line and each entry is used at most once. Exact matches win;
 * a line without its own entry no longer borrows a neighbour's, and two lines starting
 * together (a duet) do not both claim the first entry.
 */
export const matchOverlayByTime = (
    mainLines: SynchronizedLyricLine[],
    overlayEntries: TimedTextEntry[],
): (null | string)[] => {
    const result: (null | string)[] = mainLines.map(() => null);

    if (mainLines.length === 0 || overlayEntries.length === 0) {
        return result;
    }

    const candidates: { diff: number; entry: number; line: number }[] = [];

    mainLines.forEach((line, lineIndex) => {
        const start = lowerBoundByStartMs(overlayEntries, line.startMs - OVERLAY_MATCH_WINDOW_MS);

        for (
            let entry = start;
            entry < overlayEntries.length &&
            overlayEntries[entry].startMs < line.startMs + OVERLAY_MATCH_WINDOW_MS;
            entry += 1
        ) {
            const diff = Math.abs(overlayEntries[entry].startMs - line.startMs);

            if (diff < OVERLAY_MATCH_WINDOW_MS) {
                candidates.push({ diff, entry, line: lineIndex });
            }
        }
    });

    candidates.sort((a, b) => a.diff - b.diff || a.line - b.line || a.entry - b.entry);

    const lineTaken = mainLines.map(() => false);
    const entryTaken = overlayEntries.map(() => false);

    for (const candidate of candidates) {
        if (lineTaken[candidate.line] || entryTaken[candidate.entry]) {
            continue;
        }

        lineTaken[candidate.line] = true;
        entryTaken[candidate.entry] = true;
        result[candidate.line] = overlayEntries[candidate.entry].text;
    }

    return result;
};

/** Build a line-level overlay track aligned to the main lines' timestamps. */
export const buildOverlayTrack = (
    mainLines: SynchronizedLyricLine[],
    texts: (null | string)[],
): null | SynchronizedLyrics => {
    const track: SynchronizedLyrics = [];

    for (let index = 0; index < mainLines.length; index += 1) {
        const text = texts[index];

        if (text === null || text === undefined || text.length === 0) {
            continue;
        }

        track.push({ startMs: mainLines[index].startMs, text });
    }

    return track.length > 0 ? track : null;
};
