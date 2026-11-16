import axios from 'axios';

import { orderSearchResults } from '../shared';
import { qrcDecrypt } from './qrc-decrypt';
import { buildProviderResult, LyricsProvider } from './result';

import log from '/@/main/logger';
import { parseLrc, parseQrc } from '/@/shared/lyrics';
import {
    InternetProviderLyricSearchResponse,
    LyricSearchQuery,
    LyricsFetchOptions,
    ProviderLyricsResult,
} from '/@/shared/types/domain-types';
import { LyricSource } from '/@/shared/types/domain-types';

const API_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const TIMEOUT_MS = 10000;

// QRC word timing markers look like (start,duration[,flag]). Their presence distinguishes a
// word-level QRC track from the line-level LRC the server returns for songs without QRC.
const QRC_WORD_PATTERN = /\(\d+,\d+(?:,\d+)?\)/;

const COMM = {
    ct: 11,
    cv: '1003006',
    nettype: 'NETWORK_WIFI',
    os_ver: '15',
    phonetype: '24122RKC7C',
    rom: 'Redmi/miro/miro:15/AE3A.240806.005/OS2.0.102.0.VOMCNXM:user/release-keys',
    tmeAppID: 'qqmusiclight',
    udid: '0',
    uid: '0',
    v: '1003006',
};

type QqSong = {
    album?: { mid?: string; name?: string };
    id: number;
    interval: number;
    mid?: string;
    name: string;
    singer?: { name: string }[];
};

type QqSongMeta = {
    albumName: string;
    interval: number;
    singerName: string;
    songName: string;
};

// Search candidates carry the metadata GetPlayLyricInfo needs; keep it briefly so a
// follow-up fetch (auto upgrade or manual bind) can build the request without a re-search.
const songMetaCache = new Map<string, QqSongMeta>();

const request = async (method: string, module: string, param: unknown): Promise<any> => {
    const { data } = await axios.post(
        API_URL,
        { comm: COMM, request: { method, module, param } },
        {
            headers: {
                'Content-Type': 'application/json',
                Cookie: 'tmeLoginType=-1;',
                'User-Agent': 'okhttp/3.14.9',
            },
            timeout: TIMEOUT_MS,
        },
    );

    if (data?.code !== 0 || data?.request?.code !== 0) {
        throw new Error(`QQ API error: code ${data?.code ?? data?.request?.code}`);
    }

    return data.request.data;
};

const toBase64 = (value: string): string => Buffer.from(value, 'utf8').toString('base64');

const search = async (
    params: LyricSearchQuery,
): Promise<InternetProviderLyricSearchResponse[] | null> => {
    const query = [params.artist, params.name].filter(Boolean).join(' ');

    if (!query) {
        return null;
    }

    try {
        const data = await request('DoSearchForQQMusicLite', 'music.search.SearchCgiService', {
            grp: 1,
            highlight: 0,
            nqc_flag: 0,
            num_per_page: 5,
            page_id: 1,
            page_num: 1,
            query: query.length > 60 ? query.slice(0, 60) : query,
            remoteplace: 'search.android.keyboard',
            search_id: String(Date.now()),
            search_type: 7,
        });

        const songs: QqSong[] = data?.body?.item_song ?? [];

        const results: InternetProviderLyricSearchResponse[] = songs.map((song) => {
            const singerName = song.singer?.map((singer) => singer.name).join(', ') ?? '';

            songMetaCache.set(String(song.id), {
                albumName: song.album?.name ?? '',
                interval: song.interval ?? 0,
                singerName,
                songName: song.name,
            });

            return {
                artist: singerName,
                duration: song.interval,
                id: String(song.id),
                isSync: null,
                name: song.name,
                source: LyricSource.QQMUSIC,
            };
        });

        return orderSearchResults({ params, results });
    } catch (error) {
        log.error('QQ Music search request failed:', (error as Error)?.message);
        return null;
    }
};

const decryptTrack = async (hex: string | undefined): Promise<null | string> => {
    if (!hex) {
        return null;
    }

    try {
        return await qrcDecrypt(hex);
    } catch (error) {
        log.error('QQ Music QRC decrypt failed:', (error as Error)?.message);
        return null;
    }
};

const fetch = async (
    remoteId: string,
    options: LyricsFetchOptions,
): Promise<null | ProviderLyricsResult> => {
    const meta = songMetaCache.get(remoteId);

    try {
        const data = await request('GetPlayLyricInfo', 'music.musichallSong.PlayLyricInfo', {
            albumName: toBase64(meta?.albumName ?? ''),
            crypt: 1,
            ct: 19,
            cv: 2111,
            interval: meta?.interval ?? 0,
            lrc_t: 0,
            qrc: 1,
            qrc_t: 0,
            roma: options.fetchRomanization ? 1 : 0,
            roma_t: 0,
            singerName: toBase64(meta?.singerName ?? ''),
            songID: Number(remoteId),
            songName: toBase64(meta?.songName ?? ''),
            trans: options.fetchTranslation ? 1 : 0,
            trans_t: 0,
            type: 0,
        });

        const mainRaw = await decryptTrack(data?.lyric);

        if (!mainRaw) {
            return null;
        }

        const translationRaw = options.fetchTranslation ? await decryptTrack(data?.trans) : null;
        const romanizationRaw = options.fetchRomanization ? await decryptTrack(data?.roma) : null;
        const isWordLevel = QRC_WORD_PATTERN.test(mainRaw);
        const parsed = isWordLevel
            ? parseQrc(mainRaw, translationRaw, romanizationRaw)
            : parseLrc(mainRaw, translationRaw, romanizationRaw);

        return buildProviderResult({
            artist: meta?.singerName ?? '',
            name: meta?.songName ?? '',
            parsed,
            rawText: mainRaw,
            remoteId,
            source: LyricSource.QQMUSIC,
            sourceFormat: isWordLevel ? 'qrc' : 'lrc',
        });
    } catch (error) {
        log.error('QQ Music lyrics request failed:', (error as Error)?.message);
        return null;
    }
};

export const qqProvider: LyricsProvider = {
    fetch,
    search,
    source: LyricSource.QQMUSIC,
};
