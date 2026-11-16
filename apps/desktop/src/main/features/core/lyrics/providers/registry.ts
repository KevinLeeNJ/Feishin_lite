import { getLyricsBySongId, getSearchResults } from '../genius';
import { getLyricsBySongId as getLrcLibLyrics, getSearchResults as searchLrcLib } from '../lrclib';
import {
    getLyricsBySongId as getSimpMusicLyrics,
    getSearchResults as searchSimpMusic,
} from '../simpmusic';
import { kugouProvider } from './kugou';
import { createLegacyProvider } from './legacy';
import { neteaseProvider } from './netease';
import { qqProvider } from './qq';
import { LyricsProvider } from './result';

import { LyricSource } from '/@/shared/types/domain-types';

/** Every selectable lyrics source, keyed by the shared enum used in the settings menu. */
export const PROVIDERS: Record<LyricSource, LyricsProvider> = {
    [LyricSource.GENIUS]: createLegacyProvider(LyricSource.GENIUS, {
        getLyricsBySongId,
        getSearchResults,
    }),
    [LyricSource.KUGOU]: kugouProvider,
    [LyricSource.LRCLIB]: createLegacyProvider(LyricSource.LRCLIB, {
        getLyricsBySongId: getLrcLibLyrics,
        getSearchResults: searchLrcLib,
    }),
    [LyricSource.NETEASE]: neteaseProvider,
    [LyricSource.QQMUSIC]: qqProvider,
    [LyricSource.SIMPMUSIC]: createLegacyProvider(LyricSource.SIMPMUSIC, {
        getLyricsBySongId: getSimpMusicLyrics,
        getSearchResults: searchSimpMusic,
    }),
};

export const getProvider = (source: LyricSource): LyricsProvider | undefined => PROVIDERS[source];
