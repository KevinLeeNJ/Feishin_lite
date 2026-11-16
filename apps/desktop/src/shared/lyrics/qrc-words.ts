import { SyncedWordCue } from '/@/shared/types/domain-types';

const QRC_WORD_TAG = /\((\d+),(\d+)(?:,\d+)?\)/g;

type QrcTag = {
    durationMs: number;
    startMs: number;
    tagEnd: number;
    tagStart: number;
};

/**
 * Extract word cues from the body of a QRC line (the text after `[start,duration]`).
 * QRC word tags are `(startMs,durationMs[,flag])` with absolute millisecond times.
 * The word text may sit before or after its tag depending on the exporter, so the
 * leading/trailing chunks are compared per Folia's AGPL-3.0 parserCore rule.
 */
export const parseQrcWords = (rest: string): SyncedWordCue[] => {
    const tags: QrcTag[] = [...rest.matchAll(QRC_WORD_TAG)].map((match) => ({
        durationMs: parseInt(match[2], 10),
        startMs: parseInt(match[1], 10),
        tagEnd: (match.index ?? 0) + match[0].length,
        tagStart: match.index ?? 0,
    }));

    if (tags.length === 0) {
        return [];
    }

    const chunks: string[] = [];
    let cursor = 0;

    for (const tag of tags) {
        chunks.push(rest.slice(cursor, tag.tagStart));
        cursor = tag.tagEnd;
    }

    chunks.push(rest.slice(cursor));

    const prefersLeading =
        chunks[0].trim().length > 0 && chunks[chunks.length - 1].trim().length === 0;
    const prefersTrailing =
        chunks[0].trim().length === 0 && chunks[chunks.length - 1].trim().length > 0;

    const words: SyncedWordCue[] = [];

    for (let index = 0; index < tags.length; index += 1) {
        const tag = tags[index];
        const leading = chunks[index] ?? '';
        const trailing = chunks[index + 1] ?? '';
        const text = pickWordText(leading, trailing, prefersLeading, prefersTrailing);

        if (text.length === 0) {
            continue;
        }

        words.push({
            endMs: tag.startMs + tag.durationMs,
            startMs: tag.startMs,
            text,
        });
    }

    return words;
};

const pickWordText = (
    leading: string,
    trailing: string,
    prefersLeading: boolean,
    prefersTrailing: boolean,
): string => {
    if (prefersLeading) {
        return leading;
    }

    if (prefersTrailing) {
        return trailing;
    }

    if (trailing.trim().length > 0 && leading.trim().length === 0) {
        return trailing;
    }

    if (leading.trim().length > 0 && trailing.trim().length === 0) {
        return leading;
    }

    return trailing.length >= leading.length ? trailing : leading;
};

/** Concatenate the word text of a QRC line body into its full line text. */
export const qrcLineText = (rest: string): string =>
    parseQrcWords(rest)
        .map((word) => word.text)
        .join('');
