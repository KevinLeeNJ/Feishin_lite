import { parseKrc } from './krc';
import { parseLrc } from './lrc';
import { parseQrc } from './qrc';
import { emptyParsedLyrics, ParsedLyrics } from './types';
import { parseYrc } from './yrc';

import { LyricsSourceFormat } from '/@/shared/types/domain-types';

export { parseKrc } from './krc';
export { parseLrc } from './lrc';
export { buildOverlayTrack, matchOverlayByTime, parseLrcEntries } from './overlay';
export { parseQrc } from './qrc';
export { parseQrcWords } from './qrc-words';
export { parseTimedTrackEntries } from './timed-track';
export { emptyParsedLyrics } from './types';
export type { ParsedLyrics, TimedTextEntry } from './types';
export { parseYrc } from './yrc';

/**
 * Parse a lyric document by its source format. Plain text has no timing and yields
 * an empty synchronized result; callers handle unsynchronized text separately.
 */
export const parseLyricsByFormat = (
    format: LyricsSourceFormat,
    content: string,
    translation?: null | string,
    romanization?: null | string,
): ParsedLyrics => {
    switch (format) {
        case 'krc':
            return parseKrc(content, translation, romanization);
        case 'lrc':
            return parseLrc(content, translation, romanization);
        case 'qrc':
            return parseQrc(content, translation, romanization);
        case 'yrc':
            return parseYrc(content, translation, romanization);
        case 'text':
        default:
            return emptyParsedLyrics();
    }
};
