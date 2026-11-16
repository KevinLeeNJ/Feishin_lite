import { ParsedLyrics } from '/@/shared/lyrics';
import {
    FullLyricsMetadata,
    InternetProviderLyricSearchResponse,
    LyricSearchQuery,
    LyricsFetchOptions,
    LyricsSourceFormat,
    LyricsTimingGranularity,
    ProviderLyricsResult,
    SynchronizedLyrics,
} from '/@/shared/types/domain-types';
import { LyricSource } from '/@/shared/types/domain-types';

/** A lyrics source able to search candidates and fetch a normalized result. */
export interface LyricsProvider {
    fetch: (remoteId: string, options: LyricsFetchOptions) => Promise<null | ProviderLyricsResult>;
    search: (params: LyricSearchQuery) => Promise<InternetProviderLyricSearchResponse[] | null>;
    source: LyricSource;
}

const hasWordCues = (lines: SynchronizedLyrics): boolean =>
    lines.some((line) => line.cueLines?.some((cue) => cue.words.length > 0));

/**
 * Normalize a parsed lyric document into a provider result. When the document has no
 * timed lines (plain text), the raw text is kept as an unsynchronized string so callers
 * can still display it.
 */
export const buildProviderResult = (args: {
    artist: string;
    matchConfidence?: number;
    name: string;
    offsetMs?: null | number;
    parsed: ParsedLyrics;
    rawText: string;
    remoteId: string;
    source: LyricSource;
    sourceFormat: LyricsSourceFormat;
}): ProviderLyricsResult => {
    const {
        artist,
        matchConfidence,
        name,
        offsetMs,
        parsed,
        rawText,
        remoteId,
        source,
        sourceFormat,
    } = args;

    const synced = parsed.lines.length > 0;
    const timingGranularity: LyricsTimingGranularity | undefined = synced
        ? hasWordCues(parsed.lines)
            ? 'word'
            : 'line'
        : undefined;

    const lyrics: FullLyricsMetadata = {
        artist,
        lyrics: synced ? parsed.lines : rawText,
        matchConfidence,
        name,
        offsetMs: offsetMs ?? null,
        remote: true,
        remoteId,
        source,
        sourceFormat: synced ? sourceFormat : 'text',
        timingGranularity,
    };

    return {
        lyrics,
        romanization: parsed.romanization,
        translation: parsed.translation,
    };
};
