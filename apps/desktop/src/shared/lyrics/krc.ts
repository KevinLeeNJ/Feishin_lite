import { buildOverlayTrack, matchOverlayByTime } from './overlay';
import { parseTimedTrackEntries } from './timed-track';
import { ParsedLyrics } from './types';

import { SynchronizedLyricLine, SynchronizedLyrics } from '/@/shared/types/domain-types';

const KRC_LINE = /^\[(\d+),(\d+)\](.*)$/;
const KRC_WORD = /<(\d+),(\d+)(?:,\d+)?>([^<]*)/g;
const KRC_LANGUAGE = /\[language:([^\]]*)\]/;

type EmbeddedTracks = {
    romanizations: string[];
    translations: string[];
};

const decodeBase64Utf8 = (base64: string): string => {
    let padded = base64.trim();

    while (padded.length % 4 !== 0) {
        padded += '=';
    }

    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));

    return new TextDecoder('utf-8').decode(bytes);
};

const readEmbeddedTrack = (content: unknown, type: number): string[] => {
    if (!Array.isArray(content)) {
        return [];
    }

    const track = content.find(
        (item): item is { lyricContent: unknown; type: number } =>
            typeof item === 'object' && item !== null && (item as { type?: unknown }).type === type,
    );

    if (!track || !Array.isArray(track.lyricContent)) {
        return [];
    }

    return track.lyricContent.map((line) =>
        Array.isArray(line) ? line.join('').trim() : String(line).trim(),
    );
};

const decodeEmbeddedTracks = (raw: string): EmbeddedTracks => {
    const match = KRC_LANGUAGE.exec(raw);

    if (!match) {
        return { romanizations: [], translations: [] };
    }

    try {
        const parsed = JSON.parse(decodeBase64Utf8(match[1])) as { content?: unknown };

        return {
            romanizations: readEmbeddedTrack(parsed.content, 0),
            translations: readEmbeddedTrack(parsed.content, 1),
        };
    } catch {
        return { romanizations: [], translations: [] };
    }
};

const parseKrcLine = (
    lineStartMs: number,
    lineDurationMs: number,
    content: string,
): null | SynchronizedLyricLine => {
    const words = [...content.matchAll(KRC_WORD)].map((match) => {
        const startMs = lineStartMs + parseInt(match[1], 10);
        const durationMs = parseInt(match[2], 10);

        return {
            endMs: startMs + durationMs,
            startMs,
            text: match[3],
        };
    });

    if (words.length > 0) {
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
    }

    const trimmed = content.trim();

    if (trimmed.length === 0 || trimmed.startsWith('[') || trimmed.startsWith('<')) {
        return null;
    }

    return { startMs: lineStartMs, text: trimmed };
};

/**
 * Parse decoded Kugou KRC word-level lyrics. Word offsets are relative to the line
 * start. Translation/romanization come from the embedded [language:base64] section
 * (type 1 / type 0, aligned by line index) or from external timed tracks.
 */
export const parseKrc = (
    raw: string,
    translationRaw?: null | string,
    romanizationRaw?: null | string,
): ParsedLyrics => {
    const embedded = decodeEmbeddedTracks(raw);
    const lines: SynchronizedLyrics = [];

    for (const rawLine of raw.replace(/^/, '').split(/\r?\n/)) {
        const match = KRC_LINE.exec(rawLine.trim());

        if (!match) {
            continue;
        }

        const line = parseKrcLine(parseInt(match[1], 10), parseInt(match[2], 10), match[3]);

        if (line) {
            lines.push(line);
        }
    }

    lines.sort((a, b) => a.startMs - b.startMs);

    const externalTranslation = translationRaw
        ? matchOverlayByTime(lines, parseTimedTrackEntries(translationRaw))
        : [];
    const externalRomanization = romanizationRaw
        ? matchOverlayByTime(lines, parseTimedTrackEntries(romanizationRaw))
        : [];

    const translationTexts = lines.map(
        (_, index) => embedded.translations[index] || externalTranslation[index] || null,
    );
    const romanizationTexts = lines.map(
        (_, index) => embedded.romanizations[index] || externalRomanization[index] || null,
    );

    return {
        lines,
        romanization: buildOverlayTrack(lines, romanizationTexts),
        translation: buildOverlayTrack(lines, translationTexts),
    };
};
