import { buildProviderResult, LyricsProvider } from './result';

import { parseLrc } from '/@/shared/lyrics';
import {
    InternetProviderLyricSearchResponse,
    LyricSearchQuery,
    LyricSource,
    ProviderLyricsResult,
} from '/@/shared/types/domain-types';

/** The original Feishin string-based provider shape (search + fetch raw lyric text). */
export interface LegacyLyricFetcher {
    getLyricsBySongId: (id: string) => Promise<null | string>;
    getSearchResults: (
        params: LyricSearchQuery,
    ) => Promise<InternetProviderLyricSearchResponse[] | null>;
}

/**
 * Adapt a legacy text provider to the unified interface. Raw LRC is parsed into timed
 * lines; plain text (e.g. Genius) yields no lines and is kept as an unsynchronized string.
 * These sources have no translation/romanization tracks.
 */
export const createLegacyProvider = (
    source: LyricSource,
    fetcher: LegacyLyricFetcher,
): LyricsProvider => ({
    fetch: async (remoteId): Promise<null | ProviderLyricsResult> => {
        const rawText = await fetcher.getLyricsBySongId(remoteId);

        if (!rawText) {
            return null;
        }

        return buildProviderResult({
            artist: '',
            name: '',
            parsed: parseLrc(rawText),
            rawText,
            remoteId,
            source,
            sourceFormat: 'lrc',
        });
    },
    search: fetcher.getSearchResults,
    source,
});
