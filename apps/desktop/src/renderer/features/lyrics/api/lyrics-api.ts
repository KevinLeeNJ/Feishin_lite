import { queryOptions } from '@tanstack/react-query';

import { api } from '/@/renderer/api';
import { queryKeys } from '/@/renderer/api/query-keys';
import { getDefaultStructuredIndex } from '/@/renderer/features/lyrics/api/lyrics-utils';
import { queryClient, QueryHookArgs } from '/@/renderer/lib/react-query';
import { getServerById, useSettingsStore } from '/@/renderer/store';
import { hasFeature } from '/@/shared/api/utils';
import {
    FullLyricsMetadata,
    InternetProviderLyricSearchResponse,
    LyricGetQuery,
    LyricSearchQuery,
    LyricsFetchOptions,
    LyricsOverride,
    LyricsQuery,
    LyricsScope,
    ProviderLyricsResult,
    QueueSong,
    RemoteLyricsAutoResult,
    Song,
    StructuredLyric,
    SynchronizedLyrics,
} from '/@/shared/types/domain-types';
import { LyricSource } from '/@/shared/types/domain-types';
import { LyricsResponse } from '/@/shared/types/domain-types';
import { ServerFeature } from '/@/shared/types/features-types';

// Resolve the IPC bridge at call time, not module load: in dev the renderer module graph can be
// evaluated before the preload bridge is exposed, which would otherwise latch a null bridge and
// silently disable every remote fetch for the whole session.
const getLyricsIpc = () => (typeof window !== 'undefined' && window.api ? window.api.lyrics : null);

export type LyricsQueryResult = {
    local: FullLyricsMetadata | null | StructuredLyric[];
    overrideData: null | ProviderLyricsResult;
    overrideSelection: LyricsOverride | null;
    remoteAuto: null | ProviderLyricsResult;
    selected: FullLyricsMetadata | null | StructuredLyric;
    selectedOffsetMs: null | number;
    selectedRomanization: null | SynchronizedLyrics;
    selectedStructuredIndex: number;
    selectedSynced: boolean;
    selectedTranslation: null | SynchronizedLyrics;
    suppressRemoteAuto: boolean;
};

// Match LRC lyrics format by https://github.com/ustbhuangyi/lyric-parser
// [mm:ss.SSS] text
const timeExp = /\[(\d{2,}):(\d{2})(?:\.(\d{2,3}))?]([^\n]+)(\n|$)/g;

// Match karaoke lyrics format returned by NetEase
// [SSS,???] text
const alternateTimeExp = /\[(\d*),(\d*)]([^\n]+)(\n|$)/g;

const formatLyrics = (lyrics: string) => {
    const synchronizedLines = lyrics.matchAll(timeExp);
    const formattedLyrics: SynchronizedLyrics = [];

    for (const line of synchronizedLines) {
        const [, minute, sec, ms, text] = line;
        const minutes = parseInt(minute, 10);
        const seconds = parseInt(sec, 10);
        let milis = 0;
        if (ms) {
            milis = ms.length === 3 ? parseInt(ms, 10) : parseInt(ms, 10) * 10;
        }

        const timeInMilis = (minutes * 60 + seconds) * 1000 + milis;

        formattedLyrics.push({ startMs: timeInMilis, text });
    }

    if (formattedLyrics.length > 0) return formattedLyrics;

    const alternateSynchronizedLines = lyrics.matchAll(alternateTimeExp);
    for (const line of alternateSynchronizedLines) {
        const [, timeInMilis, , text] = line;
        const cleanText = text
            .replaceAll(/\(\d+,\d+\)/g, '')
            .replaceAll(/\s,/g, ',')
            .replaceAll(/\s\./g, '.');
        formattedLyrics.push({ startMs: Number(timeInMilis), text: cleanText });
    }

    if (formattedLyrics.length > 0) return formattedLyrics;

    // If no synchronized lyrics were found, return the original lyrics
    return lyrics;
};

export const formatLyricsForDisplay = formatLyrics;

// Generation guards late background upgrades: a resolve only applies while the key's
// generation still matches the one captured when the fetch started.
const generations = new Map<string, number>();

export const bumpLyricsGeneration = (key: readonly unknown[]): void => {
    const id = JSON.stringify(key);
    generations.set(id, (generations.get(id) ?? 0) + 1);
};

const currentGeneration = (key: readonly unknown[]): number =>
    generations.get(JSON.stringify(key)) ?? 0;

const hasWordCues = (lyrics: LyricsResponse): boolean =>
    Array.isArray(lyrics) &&
    lyrics.some((line) => line.cueLines?.some((cue) => cue.words.length > 0));

/** Quality rank used to decide whether a background remote result may upgrade the display. */
const qualityRank = (selected: FullLyricsMetadata | null | StructuredLyric): number => {
    if (!selected || !('lyrics' in selected)) return 0;
    if (!Array.isArray(selected.lyrics)) return 1;
    return hasWordCues(selected.lyrics) ? 3 : 2;
};

export function computeSelectedFromResult(
    result: Pick<
        LyricsQueryResult,
        'local' | 'overrideData' | 'overrideSelection' | 'remoteAuto' | 'selectedOffsetMs'
    >,
    preferLocalLyrics: boolean,
    selectedStructuredIndex: number,
): {
    selected: FullLyricsMetadata | null | StructuredLyric;
    selectedRomanization: null | SynchronizedLyrics;
    selectedSynced: boolean;
    selectedTranslation: null | SynchronizedLyrics;
} {
    const { local, overrideData, overrideSelection, remoteAuto, selectedOffsetMs } = result;

    const fromProvider = (provider: ProviderLyricsResult, remote: boolean) => ({
        selected: { ...provider.lyrics, offsetMs: selectedOffsetMs, remote },
        selectedRomanization: provider.romanization,
        selectedSynced: Array.isArray(provider.lyrics.lyrics),
        selectedTranslation: provider.translation,
    });

    // Override takes precedence over local and remote lyrics in all scenarios if available
    if (overrideSelection && overrideData) {
        return fromProvider(overrideData, overrideSelection.remote ?? true);
    }

    // local-only mode: never auto-upgrade to remote, but a manual override still wins above
    if (preferLocalLyrics && hasLocalLyrics(local)) {
        return selectLocal(local, selectedStructuredIndex);
    }

    if (remoteAuto) {
        return fromProvider(remoteAuto, true);
    }

    return selectLocal(local, selectedStructuredIndex);
}

const selectLocal = (
    local: FullLyricsMetadata | null | StructuredLyric[],
    selectedStructuredIndex: number,
) => {
    const empty = {
        selectedRomanization: null,
        selectedTranslation: null,
    };

    if (Array.isArray(local) && local.length > 0) {
        const item = local[Math.min(selectedStructuredIndex, local.length - 1)];
        return { selected: item, selectedSynced: item.synced, ...empty };
    }

    if (local != null && !Array.isArray(local) && 'lyrics' in local && local.lyrics) {
        return {
            selected: local,
            selectedSynced: Array.isArray(local.lyrics),
            ...empty,
        };
    }

    return { selected: null, selectedSynced: false, ...empty };
};

export async function fetchLocalLyrics(params: {
    serverId: string;
    signal?: AbortSignal;
    song: QueueSong;
}): Promise<FullLyricsMetadata | null | StructuredLyric[]> {
    const { serverId, signal, song } = params;

    const server = getServerById(serverId);
    if (!server) throw new Error('Server not found');

    if (hasFeature(server, ServerFeature.LYRICS_MULTIPLE_STRUCTURED)) {
        const subsonicLyrics = await api.controller
            .getStructuredLyrics({
                apiClientProps: { serverId, signal },
                query: { songId: song.id },
            })
            .catch(console.error);
        if (subsonicLyrics?.length) return subsonicLyrics;
    } else if (hasFeature(server, ServerFeature.LYRICS_SINGLE_STRUCTURED)) {
        const jfLyrics = await api.controller
            .getLyrics({
                apiClientProps: { serverId, signal },
                query: { songId: song.id },
            })
            .catch((err) => console.error(err));
        if (jfLyrics) {
            return {
                artist: song.artists?.[0]?.name,
                lyrics: jfLyrics,
                name: song.name,
                remote: false,
                source: server?.name ?? 'music server',
            };
        }
    } else if (song.lyrics) {
        return {
            artist: song.artists?.[0]?.name,
            lyrics: formatLyrics(song.lyrics),
            name: song.name,
            remote: false,
            source: server?.name ?? 'music server',
        };
    }
    return null;
}

const readFetchOptions = (): LyricsFetchOptions => {
    const { enableRomaji, fetchTranslation, ignoreTitleTranslation, sources } =
        useSettingsStore.getState().lyrics;
    return {
        fetchRomanization: !!enableRomaji,
        fetchTranslation,
        ignoreTitleTranslation,
        sources,
    };
};

const buildScope = (serverId: string, song: QueueSong | Song): LyricsScope => ({
    accountId: getServerById(serverId)?.username ?? '',
    serverId,
    songId: String(song.id),
});

export async function fetchRemoteLyricsAuto(
    song: QueueSong,
    serverId: string,
): Promise<RemoteLyricsAutoResult> {
    const { fetch } = useSettingsStore.getState().lyrics;
    const lyricsIpc = getLyricsIpc();
    if (!fetch || !lyricsIpc) return { fallbacks: [], result: null };
    return lyricsIpc.getRemoteLyricsBySong(song, readFetchOptions(), buildScope(serverId, song));
}

export async function fetchRemoteLyricsById(params: {
    remoteSongId: string;
    remoteSource: LyricSource;
    song?: QueueSong | Song;
}): Promise<null | ProviderLyricsResult> {
    const lyricsIpc = getLyricsIpc();
    if (!lyricsIpc) return null;
    const { remoteSongId, remoteSource, song } = params;
    return lyricsIpc.getRemoteLyricsByRemoteId(
        { remoteSongId, remoteSource, song: song as Song },
        readFetchOptions(),
    );
}

/** Background word-level cascade: try fallback candidates (one per source) until one is word-level. */
export async function fetchWordLevelCascade(
    fallbacks: InternetProviderLyricSearchResponse[],
    song: QueueSong,
    serverId: string,
): Promise<null | ProviderLyricsResult> {
    const lyricsIpc = getLyricsIpc();
    if (!lyricsIpc) return null;
    return lyricsIpc.cascadeWordLevelLyrics(
        fallbacks,
        readFetchOptions(),
        buildScope(serverId, song),
        song,
    );
}

export function getDisplayOffset(
    selected: FullLyricsMetadata | null | StructuredLyric,
    storedOffsetMs: null | number,
    selectedStructuredIndex: number,
    local: FullLyricsMetadata | null | StructuredLyric[],
    defaultOffsetMs = 0,
): number {
    if (selected && 'offsetMs' in selected && selected.offsetMs != null) {
        return selected.offsetMs;
    }

    if (Array.isArray(local) && local.length > 0) {
        const item = local[Math.min(selectedStructuredIndex, local.length - 1)];
        if (item.offsetMs != null) {
            return item.offsetMs;
        }
    }

    return storedOffsetMs ?? defaultOffsetMs;
}

export function hasLocalLyrics(local: FullLyricsMetadata | null | StructuredLyric[]): boolean {
    return (
        (Array.isArray(local) && local.length > 0) ||
        (local != null && !Array.isArray(local) && 'lyrics' in local && Boolean(local.lyrics))
    );
}

const emptyResult = (): LyricsQueryResult => ({
    local: null,
    overrideData: null,
    overrideSelection: null,
    remoteAuto: null,
    selected: null,
    selectedOffsetMs: null,
    selectedRomanization: null,
    selectedStructuredIndex: 0,
    selectedSynced: false,
    selectedTranslation: null,
    suppressRemoteAuto: false,
});

/**
 * Display the primary remote result, then run the word-level cascade in the background when the
 * primary is not word-level. Every upgrade flows through the same quality/generation guards so a
 * late result never downgrades the display or leaks across a song change.
 */
const scheduleRemoteAutoUpgrade = (args: {
    generation: number;
    lyricsKey: readonly unknown[];
    preferLocalLyrics: boolean;
    serverId: string;
    signal: AbortSignal;
    song: QueueSong;
}): void => {
    const { generation, lyricsKey, preferLocalLyrics, serverId, signal, song } = args;

    const applyRemoteUpgrade = (candidate: ProviderLyricsResult) => {
        queryClient.setQueryData<LyricsQueryResult>(lyricsKey, (current) => {
            if (!current || current.suppressRemoteAuto || current.overrideSelection) {
                return current;
            }
            const upgraded = computeSelectedFromResult(
                { ...current, remoteAuto: candidate },
                preferLocalLyrics,
                current.selectedStructuredIndex,
            );
            // Only upgrade when at least as good as what is displayed; never downgrade word to line.
            if (qualityRank(upgraded.selected) < qualityRank(current.selected)) {
                return { ...current, remoteAuto: candidate };
            }
            return { ...current, remoteAuto: candidate, ...upgraded };
        });
    };

    const isCurrent = () => !signal.aborted && currentGeneration(lyricsKey) === generation;

    void fetchRemoteLyricsAuto(song, serverId).then(({ fallbacks, result }) => {
        if (!isCurrent()) return;
        if (result) {
            applyRemoteUpgrade(result);
        }

        const needsCascade =
            result && result.lyrics.timingGranularity !== 'word' && fallbacks.length > 0;
        if (!needsCascade) return;

        void fetchWordLevelCascade(fallbacks, song, serverId).then((upgraded) => {
            if (!isCurrent() || !upgraded) return;
            applyRemoteUpgrade(upgraded);
        });
    });
};

export const lyricsQueries = {
    search: (args: Omit<QueryHookArgs<LyricSearchQuery>, 'serverId'>) => {
        return queryOptions({
            gcTime: 1000 * 60 * 1,
            queryFn: () => {
                const lyricsIpc = getLyricsIpc();
                if (lyricsIpc) {
                    return lyricsIpc.searchRemoteLyrics(
                        args.query,
                        useSettingsStore.getState().lyrics.sources,
                    );
                }
                return {} as Record<LyricSource, InternetProviderLyricSearchResponse[]>;
            },
            queryKey: queryKeys.songs.lyricsSearch(args.query),
            staleTime: 1000 * 60 * 1,
            ...args.options,
        });
    },
    songLyrics: (args: QueryHookArgs<LyricsQuery>, song: QueueSong | undefined) => {
        const lyricsKey = queryKeys.songs.lyrics(args.serverId, args.query);
        return queryOptions({
            gcTime: Infinity,
            queryFn: async ({ signal }): Promise<LyricsQueryResult> => {
                if (!song) return emptyResult();

                const prev = queryClient.getQueryData<LyricsQueryResult>(lyricsKey);
                const overrideSelection = prev?.overrideSelection ?? null;
                // One-shot dismiss flag from "clear": consumed by this fetch (mayAutoFetch)
                // and reset in the result below so a later replay/re-enter auto-upgrades again.
                const suppressRemoteAuto = prev?.suppressRemoteAuto ?? false;
                const selectedOffsetMs = prev?.selectedOffsetMs ?? null;
                const preferLocalLyrics = useSettingsStore.getState().lyrics.preferLocalLyrics;
                const generation = currentGeneration(lyricsKey);

                const overrideDataPromise = overrideSelection
                    ? fetchRemoteLyricsById({
                          remoteSongId: overrideSelection.id,
                          remoteSource: overrideSelection.source as LyricSource,
                          song,
                      })
                    : null;

                // Local lyrics resolve first so the library LRC displays without waiting on
                // the network; the remote upgrade lands in the background afterwards.
                const local = await fetchLocalLyrics({
                    serverId: args.serverId,
                    signal,
                    song,
                });
                const overrideData = overrideDataPromise ? await overrideDataPromise : null;

                const selectedStructuredIndex =
                    prev?.selectedStructuredIndex ??
                    (Array.isArray(local) && local.length > 0
                        ? getDefaultStructuredIndex(local)
                        : 0);

                const base = {
                    ...emptyResult(),
                    local,
                    overrideData,
                    overrideSelection,
                    selectedOffsetMs,
                    selectedStructuredIndex,
                    suppressRemoteAuto: false,
                };
                const initial = computeSelectedFromResult(
                    base,
                    preferLocalLyrics,
                    selectedStructuredIndex,
                );
                const result: LyricsQueryResult = { ...base, ...initial };

                const mayAutoFetch =
                    !suppressRemoteAuto &&
                    !preferLocalLyrics &&
                    useSettingsStore.getState().lyrics.fetch &&
                    !overrideSelection;

                if (mayAutoFetch) {
                    scheduleRemoteAutoUpgrade({
                        generation,
                        lyricsKey,
                        preferLocalLyrics,
                        serverId: args.serverId,
                        signal,
                        song,
                    });
                }

                return result;
            },
            queryKey: lyricsKey,
            // Re-run on every mount/re-play so a cached non-word-level result retries the
            // word-level upgrade (e.g. after a provider fix). Word-level results are served
            // instantly from the main-process cache, so this stays cheap.
            refetchOnMount: 'always',
            staleTime: Infinity,
            ...args.options,
        });
    },
    songLyricsByRemoteId: (args: QueryHookArgs<Partial<LyricGetQuery>>) => {
        return queryOptions({
            gcTime: Infinity,
            queryFn: async () => {
                const q = args.query;
                if (!q?.remoteSongId || !q?.remoteSource) return null;
                return fetchRemoteLyricsById({
                    remoteSongId: q.remoteSongId,
                    remoteSource: q.remoteSource as LyricSource,
                    song: q.song as QueueSong | Song | undefined,
                });
            },
            queryKey: queryKeys.songs.lyricsByRemoteId(args.query),
            staleTime: Infinity,
            ...args.options,
        });
    },
};
