import { parseLrcEntries } from './overlay';
import { qrcLineText } from './qrc-words';
import { TimedTextEntry } from './types';

const QRC_LINE = /^\[(\d+),(\d+)\](.*)$/;

const looksLikeQrc = (raw: string): boolean => /\[\d+,\d+\]/.test(raw) && raw.includes('(');

const parseQrcTrackEntries = (raw: string): TimedTextEntry[] => {
    const entries: TimedTextEntry[] = [];

    for (const rawLine of raw.replace(/^/, '').split(/\r?\n/)) {
        const match = QRC_LINE.exec(rawLine.trim());

        if (!match) {
            continue;
        }

        const text = qrcLineText(match[3]).trim();

        if (text.length === 0) {
            continue;
        }

        entries.push({ startMs: parseInt(match[1], 10), text });
    }

    return entries.sort((a, b) => a.startMs - b.startMs);
};

/**
 * Parse an alternate track (translation or romanization) into line-level timed entries.
 * QQ Music delivers these tracks as QRC; NetEase and lrclib deliver plain LRC. The format
 * is detected from the content so a single entry point serves every provider.
 */
export const parseTimedTrackEntries = (raw: string): TimedTextEntry[] => {
    if (!raw || !raw.trim()) {
        return [];
    }

    return looksLikeQrc(raw) ? parseQrcTrackEntries(raw) : parseLrcEntries(raw);
};
