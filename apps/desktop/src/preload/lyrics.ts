import { ipcRenderer } from 'electron';

import {
    InternetProviderLyricSearchResponse,
    LyricGetQuery,
    LyricSearchQuery,
    LyricsFetchOptions,
    LyricsScope,
    ProviderLyricsResult,
    QueueSong,
    RemoteLyricsAutoResult,
} from '/@/shared/types/domain-types';
import { LyricSource } from '/@/shared/types/domain-types';

const getRemoteLyricsBySong = (
    song: QueueSong,
    options: LyricsFetchOptions,
    scope: LyricsScope,
): Promise<RemoteLyricsAutoResult> => {
    return ipcRenderer.invoke('lyric-by-song', { options, scope, song });
};

const cascadeWordLevelLyrics = (
    fallbacks: InternetProviderLyricSearchResponse[],
    options: LyricsFetchOptions,
    scope: LyricsScope,
    song: QueueSong,
): Promise<null | ProviderLyricsResult> => {
    return ipcRenderer.invoke('lyric-cascade-word-level', { fallbacks, options, scope, song });
};

const clearLyricsCache = (): Promise<void> => {
    return ipcRenderer.invoke('lyric-clear-cache');
};

const searchRemoteLyrics = (
    params: LyricSearchQuery,
    sources: LyricSource[],
): Promise<Record<LyricSource, InternetProviderLyricSearchResponse[]>> => {
    return ipcRenderer.invoke('lyric-search', { params, sources });
};

const getRemoteLyricsByRemoteId = (
    query: LyricGetQuery,
    options: LyricsFetchOptions,
): Promise<null | ProviderLyricsResult> => {
    return ipcRenderer.invoke('lyric-by-remote-id', { options, query });
};

const convertFurigana = (text: string): Promise<string> => {
    return ipcRenderer.invoke('lyric-convert-furigana', text);
};

const convertFuriganaFragment = (text: string): Promise<string> => {
    return ipcRenderer.invoke('lyric-convert-furigana-fragment', text);
};

const parseLyricsTextTokens = (text: string) => {
    return ipcRenderer.invoke('lyric-parse-text-tokens', text);
};

const convertRomaji = (text: string): Promise<string> => {
    return ipcRenderer.invoke('lyric-convert-romaji', text);
};

const convertRomajiTokens = (text: string) => {
    return ipcRenderer.invoke('lyric-convert-romaji-tokens', text);
};

export const lyrics = {
    cascadeWordLevelLyrics,
    clearLyricsCache,
    convertFurigana,
    convertFuriganaFragment,
    convertRomaji,
    convertRomajiTokens,
    getRemoteLyricsByRemoteId,
    getRemoteLyricsBySong,
    parseLyricsTextTokens,
    searchRemoteLyrics,
};

export type Lyrics = typeof lyrics;
