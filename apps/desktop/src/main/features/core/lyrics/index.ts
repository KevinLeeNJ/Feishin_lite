import { ipcMain } from 'electron';

import { clearAllCache } from './cache';
import {
    convertFurigana,
    convertFuriganaFragment,
    convertRomaji,
    convertRomajiTokens,
    parseLyricsTextTokens,
} from './furigana';
import {
    cascadeWordLevelLyrics,
    getRemoteLyrics,
    getRemoteLyricsById,
    searchRemoteLyrics,
} from './orchestrate';

import {
    InternetProviderLyricSearchResponse,
    LyricGetQuery,
    LyricSearchQuery,
    LyricsFetchOptions,
    LyricsScope,
    Song,
} from '/@/shared/types/domain-types';
import { LyricSource } from '/@/shared/types/domain-types';

ipcMain.handle(
    'lyric-by-song',
    async (_event, payload: { options: LyricsFetchOptions; scope: LyricsScope; song: Song }) => {
        return getRemoteLyrics(payload.song, payload.options, payload.scope);
    },
);

ipcMain.handle(
    'lyric-cascade-word-level',
    async (
        _event,
        payload: {
            fallbacks: InternetProviderLyricSearchResponse[];
            options: LyricsFetchOptions;
            scope: LyricsScope;
            song: Song;
        },
    ) => {
        return cascadeWordLevelLyrics(
            payload.fallbacks,
            payload.options,
            payload.scope,
            payload.song,
        );
    },
);

ipcMain.handle('lyric-clear-cache', async () => {
    clearAllCache();
});

ipcMain.handle(
    'lyric-search',
    async (_event, payload: { params: LyricSearchQuery; sources: LyricSource[] }) => {
        return searchRemoteLyrics(payload.params, payload.sources);
    },
);

ipcMain.handle(
    'lyric-by-remote-id',
    async (_event, payload: { options: LyricsFetchOptions; query: LyricGetQuery }) => {
        return getRemoteLyricsById(payload.query, payload.options);
    },
);

ipcMain.handle('lyric-convert-furigana', async (_event, text: string) => {
    return await convertFurigana(text);
});

ipcMain.handle('lyric-convert-furigana-fragment', async (_event, text: string) => {
    return await convertFuriganaFragment(text);
});

ipcMain.handle('lyric-parse-text-tokens', async (_event, text: string) => {
    return await parseLyricsTextTokens(text);
});

ipcMain.handle('lyric-convert-romaji', async (_event, text: string) => {
    return await convertRomaji(text);
});

ipcMain.handle('lyric-convert-romaji-tokens', async (_event, text: string) => {
    return await convertRomajiTokens(text);
});
