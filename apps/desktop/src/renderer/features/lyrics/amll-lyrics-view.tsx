import type { LyricLineMouseEvent } from '@applemusic-like-lyrics/core';

import { LyricPlayer, type LyricPlayerRef } from '@applemusic-like-lyrics/react';
import isElectron from 'is-electron';
import { useCallback, useMemo, useRef } from 'react';
import '@applemusic-like-lyrics/core/style.css';

import styles from './amll-lyrics-view.module.css';

import { normalizeLyrics } from '/@/renderer/features/lyrics/api/lyrics-utils';
import {
    toAmllLyrics,
    type WordRomanizationTrack,
} from '/@/renderer/features/lyrics/api/to-amll-lyrics';
import { useAmllPlaybackClock } from '/@/renderer/features/lyrics/hooks/use-amll-playback-clock';
import {
    useLyricsDisplaySettings,
    useLyricsSettings,
    usePlaybackType,
    usePlayerActions,
    usePlayerStoreBase,
} from '/@/renderer/store';
import { LyricAgent, SynchronizedLyrics } from '/@/shared/types/domain-types';
import { PlayerStatus, PlayerType } from '/@/shared/types/types';

const mpvPlayer = isElectron() ? window.api.mpvPlayer : null;
const utils = isElectron() ? window.api.utils : null;
const mpris = isElectron() && utils?.isLinux() ? window.api.mpris : null;

const PREVIEW_FONT_SIZE = 20;

export interface AmllLyricsViewProps {
    agents?: LyricAgent[];
    /** Matched lyric metadata, shown through AMLL's bottom line slot. */
    artist?: string;
    lyrics: SynchronizedLyrics;
    name?: string;
    offsetMs?: number;
    preview?: boolean;
    pronunciationLyrics?: null | SynchronizedLyrics;
    romajiLyrics?: null | SynchronizedLyrics;
    settingsKey?: string;
    source?: string;
    syncedRomajiLyrics?: null | WordRomanizationTrack;
    translatedLyrics?: null | string;
    translationLyrics?: null | SynchronizedLyrics;
}

/**
 * Plain-string translations arrive newline-aligned to the main lyric lines.
 * Project them onto a sparse time track so AMLL can match them by timestamp.
 */
const translationStringsToTrack = (
    lyrics: SynchronizedLyrics,
    translated: string,
): null | SynchronizedLyrics => {
    const texts = translated.split('\n');
    const track = normalizeLyrics(lyrics)
        .map((line, index) => ({ startMs: line.startMs, text: texts[index]?.trim() ?? '' }))
        .filter((line) => line.text.length > 0);
    return track.length > 0 ? track : null;
};

/**
 * Apple Music-like lyrics surface. Wraps the AMLL LyricPlayer, converts the
 * domain lyric model (word cues, translation, romanization, BG/duet agents)
 * into AMLL lines, and drives playback through an imperative RAF clock.
 * Line clicks seek the shared player; AMLL disposes its GPU resources on unmount.
 */
export const AmllLyricsView = ({
    agents,
    artist,
    lyrics,
    name,
    offsetMs = 0,
    preview = false,
    pronunciationLyrics,
    romajiLyrics,
    settingsKey = 'default',
    source,
    syncedRomajiLyrics,
    translatedLyrics,
    translationLyrics,
}: AmllLyricsViewProps) => {
    const playerRef = useRef<LyricPlayerRef | null>(null);
    const playbackType = usePlaybackType();
    const { mediaSeekToTimestamp } = usePlayerActions();
    const displaySettings = useLyricsDisplaySettings(settingsKey);
    const { alignment, followScrollAlignment, showMatch, showProvider } = useLyricsSettings();
    const status = usePlayerStoreBase((state) => state.player.status);

    const translationTrack = useMemo(() => {
        if (translationLyrics) return translationLyrics;
        if (translatedLyrics) return translationStringsToTrack(lyrics, translatedLyrics);
        return null;
    }, [lyrics, translatedLyrics, translationLyrics]);

    const romanizationTrack = pronunciationLyrics ?? romajiLyrics ?? null;

    const amllLines = useMemo(
        () =>
            toAmllLyrics({
                agents,
                lyrics,
                romanization: romanizationTrack,
                translation: translationTrack,
                wordRomanization: syncedRomajiLyrics,
            }),
        [agents, lyrics, romanizationTrack, syncedRomajiLyrics, translationTrack],
    );

    // The line array is the rebuild trigger: when it changes AMLL rebuilds at 0,
    // so pass it as the clock's rebuild key to restore the paused position.
    useAmllPlaybackClock(playerRef, offsetMs, !preview, amllLines);

    const handleSeek = useCallback(
        (timeSec: number) => {
            if (playbackType === PlayerType.LOCAL && mpvPlayer) {
                mpvPlayer.seekTo(timeSec);
            } else {
                mpris?.updateSeek(timeSec);
                mediaSeekToTimestamp(timeSec);
            }
        },
        [mediaSeekToTimestamp, playbackType],
    );

    const handleLineClick = useCallback(
        (event: LyricLineMouseEvent) => {
            const line = amllLines[event.lineIndex];
            if (line) handleSeek(line.startTime / 1000);
        },
        [amllLines, handleSeek],
    );

    const fontSize = preview
        ? PREVIEW_FONT_SIZE
        : displaySettings.fontSize && displaySettings.fontSize !== 0
          ? displaySettings.fontSize
          : undefined;

    const wrapperStyle = useMemo(() => {
        const style: Record<string, number | string> = {};
        if (fontSize !== undefined) style['--amll-lp-font-size'] = `${fontSize}px`;
        // text-align inherits through the AMLL player into the line boxes; duet
        // lines keep their own right alignment.
        style.textAlign = alignment;
        if (!preview) {
            style.paddingLeft = `${displaySettings.paddingLeft ?? 0}%`;
            style.paddingRight = `${displaySettings.paddingRight ?? 0}%`;
        }
        // AMLL absolutely positions lines and needs a definite height; guarantee
        // one inside the search preview's scroll viewport.
        if (preview) style.minHeight = '16rem';
        return style as React.CSSProperties;
    }, [alignment, displaySettings.paddingLeft, displaySettings.paddingRight, fontSize, preview]);

    // AMLL's bottom line is the native slot for lyric metadata (provider and
    // matched song), rendered after the last line like Apple Music credits.
    const bottomLine = useMemo(() => {
        if (preview) return null;
        const entries: string[] = [];
        if (showProvider && source) entries.push(source);
        if (showMatch && name) entries.push(artist ? `${name} - ${artist}` : name);
        if (entries.length === 0) return null;
        return entries.map((text) => <div key={text}>{text}</div>);
    }, [artist, name, preview, showMatch, showProvider, source]);

    return (
        <LyricPlayer
            alignPosition={(followScrollAlignment + 50) / 100}
            bottomLine={bottomLine}
            className={styles.player}
            currentTime={preview ? 0 : undefined}
            disabled={preview}
            lyricLines={amllLines}
            onLyricLineClick={preview ? undefined : handleLineClick}
            playing={preview ? false : status === PlayerStatus.PLAYING}
            ref={playerRef}
            style={wrapperStyle}
        />
    );
};
