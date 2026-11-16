import axios from 'axios';

import { orderSearchResults } from '../shared';
import { buildProviderResult, LyricsProvider } from './result';

import log from '/@/main/logger';
import { parseLrc, parseYrc } from '/@/shared/lyrics';
import {
    InternetProviderLyricSearchResponse,
    LyricSearchQuery,
    LyricsFetchOptions,
    ProviderLyricsResult,
} from '/@/shared/types/domain-types';
import { LyricSource } from '/@/shared/types/domain-types';

const SEARCH_URL = 'https://music.163.com/api/cloudsearch/pc';
const LYRICS_URL = 'https://music.163.com/api/song/lyric';
const TIMEOUT_MS = 8000;

// NetEase gates the word-level YRC track behind an anonymous client environment identifier
// (not a login). Without these headers the API strips `yrc` and returns only plain LRC.
const CLIENT_HEADERS = {
    Cookie: 'os=pc; appver=2.10.6; channel=netease;',
    Referer: 'https://music.163.com/',
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// YRC word timing markers look like (start,duration,flags). Their presence is what distinguishes
// a real word-level track from a stripped/line-only payload.
const WORD_TIMING_PATTERN = /\(\d+,\d+,\d+\)/;

type NetEaseCloudSong = {
    ar?: { name: string }[];
    dt?: number;
    id: number;
    name: string;
};

type NetEaseLyricResponse = {
    lrc?: { lyric?: string };
    romalrc?: { lyric?: string };
    tlyric?: { lyric?: string };
    yrc?: { lyric?: string };
};

const search = async (
    params: LyricSearchQuery,
): Promise<InternetProviderLyricSearchResponse[] | null> => {
    const query = [params.artist, params.name].filter(Boolean).join(' ');

    if (!query) {
        return null;
    }

    try {
        const { data } = await axios.post(
            SEARCH_URL,
            new URLSearchParams({ limit: '5', s: query, type: '1' }),
            {
                headers: {
                    ...CLIENT_HEADERS,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                timeout: TIMEOUT_MS,
            },
        );

        const songs: NetEaseCloudSong[] = data?.result?.songs ?? [];

        const results: InternetProviderLyricSearchResponse[] = songs.map((song) => ({
            artist: song.ar?.map((artist) => artist.name).join(', ') ?? '',
            duration: song.dt ? song.dt / 1000 : undefined,
            id: String(song.id),
            isSync: null,
            name: song.name,
            source: LyricSource.NETEASE,
        }));

        return orderSearchResults({ params, results });
    } catch (error) {
        log.error('NetEase search request failed:', (error as Error)?.message);
        return null;
    }
};

const fetch = async (
    remoteId: string,
    options: LyricsFetchOptions,
): Promise<null | ProviderLyricsResult> => {
    try {
        const { data } = await axios.get<NetEaseLyricResponse>(LYRICS_URL, {
            headers: CLIENT_HEADERS,
            params: {
                id: remoteId,
                kv: '1',
                lv: '1',
                rv: '-1',
                tv: '-1',
                yrv: '-1',
                ytv: '-1',
                yv: '1',
            },
            timeout: TIMEOUT_MS,
        });

        const yrc = data?.yrc?.lyric;
        const lrc = data?.lrc?.lyric;
        // Only treat YRC as word-level when it carries real word timing markers; otherwise the
        // track has no synchronized word version on NetEase and we fall back to line-level LRC.
        const useYrc = !!yrc && WORD_TIMING_PATTERN.test(yrc);
        const mainRaw = useYrc ? yrc : lrc;

        if (!mainRaw) {
            return null;
        }

        const translationRaw = options.fetchTranslation ? (data?.tlyric?.lyric ?? null) : null;
        const romanizationRaw = options.fetchRomanization ? (data?.romalrc?.lyric ?? null) : null;
        const sourceFormat = useYrc ? 'yrc' : 'lrc';
        const parsed = useYrc
            ? parseYrc(mainRaw, translationRaw, romanizationRaw)
            : parseLrc(mainRaw, translationRaw, romanizationRaw);

        return buildProviderResult({
            artist: '',
            name: '',
            parsed,
            rawText: mainRaw,
            remoteId,
            source: LyricSource.NETEASE,
            sourceFormat,
        });
    } catch (error) {
        log.error('NetEase lyrics request failed:', (error as Error)?.message);
        return null;
    }
};

export const neteaseProvider: LyricsProvider = {
    fetch,
    search,
    source: LyricSource.NETEASE,
};
