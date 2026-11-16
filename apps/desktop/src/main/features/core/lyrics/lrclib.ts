// Credits to https://github.com/tranxuanthang/lrcget for API implementation
import axios, { AxiosResponse } from 'axios';

import { orderSearchResults } from './shared';

import log from '/@/main/logger';
import {
    InternetProviderLyricSearchResponse,
    LyricSearchQuery,
    LyricSource,
} from '/@/shared/types/domain-types';

const FETCH_URL = 'https://lrclib.net/api/get';
const SEEARCH_URL = 'https://lrclib.net/api/search';

export interface LrcLibSearchResponse {
    albumName: string;
    artistName: string;
    duration?: number;
    id: number;
    instrumental?: boolean;
    name: string;
    plainLyrics: null | string;
    syncedLyrics: null | string;
}

export interface LrcLibTrackResponse {
    albumName: string;
    artistName: string;
    duration: number;
    id: number;
    instrumental: boolean;
    isrc: string;
    lang: string;
    name: string;
    plainLyrics: null | string;
    releaseDate: string;
    spotifyId: string;
    syncedLyrics: null | string;
}

export async function getLyricsBySongId(songId: string): Promise<null | string> {
    let result: AxiosResponse<LrcLibTrackResponse, any>;

    try {
        result = await axios.get<LrcLibTrackResponse>(`${FETCH_URL}/${songId}`);
    } catch (e) {
        log.error('LrcLib lyrics request got an error!', (e as Error)?.message);
        return null;
    }

    return result.data.syncedLyrics || result.data.plainLyrics || null;
}

export async function getSearchResults(
    params: LyricSearchQuery,
): Promise<InternetProviderLyricSearchResponse[] | null> {
    let result: AxiosResponse<LrcLibSearchResponse[]>;

    if (!params.name && !params.artist) {
        return null;
    }

    const searchQuery = [params.name, params.artist].join(' ');

    try {
        result = await axios.get<LrcLibSearchResponse[]>(SEEARCH_URL, {
            params: {
                q: searchQuery,
            },
        });
    } catch (e) {
        log.error('LrcLib search request got an error!', (e as Error)?.message);
        return null;
    }

    if (!result.data) return null;

    const songResults: InternetProviderLyricSearchResponse[] = result.data.map((song) => {
        return {
            artist: song.artistName,
            duration: song.duration,
            id: String(song.id),
            isSync: song.syncedLyrics ? true : false,
            name: song.name,
            source: LyricSource.LRCLIB,
        };
    });

    return orderSearchResults({ params, results: songResults });
}
