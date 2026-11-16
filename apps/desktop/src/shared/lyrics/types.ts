import { SynchronizedLyrics } from '/@/shared/types/domain-types';

/** A parsed lyrics document: main lines plus optional aligned overlay tracks. */
export type ParsedLyrics = {
    lines: SynchronizedLyrics;
    romanization: null | SynchronizedLyrics;
    translation: null | SynchronizedLyrics;
};

/** A single timed text entry used for overlay (translation/romanization) tracks. */
export type TimedTextEntry = {
    startMs: number;
    text: string;
};

export const emptyParsedLyrics = (): ParsedLyrics => ({
    lines: [],
    romanization: null,
    translation: null,
});
