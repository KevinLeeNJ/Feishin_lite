import { buildOverlayTrack, matchOverlayByTime, parseLrcEntries } from './overlay';
import { parseTimedTrackEntries } from './timed-track';
import { ParsedLyrics } from './types';

import { SynchronizedLyrics } from '/@/shared/types/domain-types';

/** Parse line-level LRC. Optional translation/romanization tracks are aligned by time. */
export const parseLrc = (
    raw: string,
    translationRaw?: null | string,
    romanizationRaw?: null | string,
): ParsedLyrics => {
    const lines: SynchronizedLyrics = parseLrcEntries(raw).map((entry) => ({
        startMs: entry.startMs,
        text: entry.text,
    }));

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
