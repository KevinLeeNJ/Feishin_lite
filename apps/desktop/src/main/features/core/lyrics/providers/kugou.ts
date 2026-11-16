import axios from 'axios';
import md5 from 'md5';

import { orderSearchResults } from '../shared';
import { krcDecode } from './krc-decode';
import { buildProviderResult, LyricsProvider } from './result';

import log from '/@/main/logger';
import { parseKrc } from '/@/shared/lyrics';
import {
    InternetProviderLyricSearchResponse,
    LyricSearchQuery,
    LyricsFetchOptions,
    ProviderLyricsResult,
} from '/@/shared/types/domain-types';
import { LyricSource } from '/@/shared/types/domain-types';

const SEARCH_URL = 'https://complexsearch.kugou.com/v2/search/song';
const LYRIC_SEARCH_URL = 'https://lyrics.kugou.com/v1/search';
const LYRIC_DOWNLOAD_URL = 'https://lyrics.kugou.com/download';
const SIGNATURE_SALT = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA';
const TIMEOUT_MS = 10000;

type KugouSong = {
    Duration: number;
    FileHash: string;
    Singers?: { name: string }[];
    SongName: string;
};

type KugouSongMeta = {
    durationMs: number;
    keyword: string;
};

// Kugou lyrics are fetched by song hash; keep the duration/keyword from search so the
// follow-up lyric search can run without repeating the song search.
const songMetaCache = new Map<string, KugouSongMeta>();

const request = async (
    url: string,
    params: Record<string, number | string>,
    module: 'Lyric' | 'SearchSong',
): Promise<any> => {
    const ms = Date.now();
    const mid = md5(String(ms));

    const values: Record<string, number | string> =
        module === 'Lyric'
            ? { ...params, appid: '3116', clientver: '11070' }
            : {
                  ...params,
                  appid: '3116',
                  clienttime: Math.floor(ms / 1000),
                  clientver: '11070',
                  dfid: '-',
                  iscorrection: '1',
                  mid,
                  platform: 'AndroidFilter',
                  token: '',
                  userid: '0',
                  uuid: '-',
              };

    const payload = Object.keys(values)
        .sort()
        .map((key) => `${key}=${values[key]}`)
        .join('');
    values.signature = md5(SIGNATURE_SALT + payload + SIGNATURE_SALT);

    const target = new URL(url);
    for (const [key, value] of Object.entries(values)) {
        target.searchParams.set(key, String(value));
    }

    const { data } = await axios.get(target.toString(), {
        headers: {
            'KG-CLIENTTIMEMS': String(ms),
            'KG-RC': '1',
            'KG-Rec': '1',
            mid,
            'User-Agent': `Android14-1070-11070-201-0-${module}-wifi`,
            ...(module === 'SearchSong' ? { 'x-router': 'complexsearch.kugou.com' } : {}),
        },
        timeout: TIMEOUT_MS,
    });

    if (data?.error_code && data.error_code !== 200) {
        throw new Error(`Kugou API ${data.error_code}: ${data.error_msg}`);
    }

    return data;
};

const search = async (
    params: LyricSearchQuery,
): Promise<InternetProviderLyricSearchResponse[] | null> => {
    const keyword = [params.artist, params.name].filter(Boolean).join(' ');

    if (!keyword) {
        return null;
    }

    try {
        const data = await request(
            SEARCH_URL,
            { keyword, page: 1, pagesize: 5, sorttype: '0' },
            'SearchSong',
        );

        const songs: KugouSong[] = data?.data?.lists ?? [];

        const results: InternetProviderLyricSearchResponse[] = songs
            .filter((song) => song.FileHash)
            .map((song) => {
                const singerName = song.Singers?.map((singer) => singer.name).join(', ') ?? '';

                songMetaCache.set(song.FileHash, {
                    durationMs: (song.Duration ?? 0) * 1000,
                    keyword: `${singerName} - ${song.SongName}`,
                });

                return {
                    artist: singerName,
                    duration: song.Duration,
                    id: song.FileHash,
                    isSync: null,
                    name: song.SongName,
                    source: LyricSource.KUGOU,
                };
            });

        return orderSearchResults({ params, results });
    } catch (error) {
        log.error('Kugou search request failed:', (error as Error)?.message);
        return null;
    }
};

const fetch = async (
    remoteId: string,
    options: LyricsFetchOptions,
): Promise<null | ProviderLyricsResult> => {
    const meta = songMetaCache.get(remoteId);

    try {
        const found = await request(
            LYRIC_SEARCH_URL,
            {
                duration: meta?.durationMs ?? 0,
                hash: remoteId,
                keyword: meta?.keyword ?? '',
                lrctxt: '1',
                man: 'no',
            },
            'Lyric',
        );

        const candidate = found?.candidates?.[0];

        if (!candidate) {
            return null;
        }

        const download = await request(
            LYRIC_DOWNLOAD_URL,
            {
                accesskey: candidate.accesskey,
                charset: 'utf8',
                client: 'mobi',
                fmt: 'krc',
                id: candidate.id,
                ver: '1',
            },
            'Lyric',
        );

        if (!download?.content) {
            return null;
        }

        const mainRaw = krcDecode(download.content);
        const parsed = parseKrc(mainRaw);

        return buildProviderResult({
            artist: '',
            name: '',
            parsed: {
                lines: parsed.lines,
                romanization: options.fetchRomanization ? parsed.romanization : null,
                translation: options.fetchTranslation ? parsed.translation : null,
            },
            rawText: mainRaw,
            remoteId,
            source: LyricSource.KUGOU,
            sourceFormat: 'krc',
        });
    } catch (error) {
        log.error('Kugou lyrics request failed:', (error as Error)?.message);
        return null;
    }
};

export const kugouProvider: LyricsProvider = {
    fetch,
    search,
    source: LyricSource.KUGOU,
};
