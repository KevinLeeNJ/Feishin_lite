import type { LyricLine, LyricWord } from '@applemusic-like-lyrics/core';

import { rubyTextToWords } from '/@/renderer/features/lyrics/api/amll-ruby';
import {
    findOverlayLineByTime,
    getLineEndMs,
    normalizeLyrics,
} from '/@/renderer/features/lyrics/api/lyrics-utils';
import {
    LyricAgent,
    SyncedCueLine,
    SynchronizedLyricLine,
    SynchronizedLyrics,
} from '/@/shared/types/domain-types';

/** AMLL's LRC sentinel for the final line's end time (999 minutes, in ms). */
const LAST_LINE_END_MS = 999 * 60 * 1000;

export interface ToAmllLyricsOptions {
    agents?: LyricAgent[];
    lyrics: SynchronizedLyrics;
    /** Line-level pronunciation overlay, mapped to AMLL romanLyric. */
    romanization?: null | SynchronizedLyrics;
    /** Line-level translation overlay, mapped to AMLL translatedLyric. */
    translation?: null | SynchronizedLyrics;
    /** Word-level romaji aligned by line/cue/word index, mapped to AMLL romanWord. */
    wordRomanization?: null | WordRomanizationTrack;
}

/** Per-line, per-cue romaji words aligned to the main cue words (generated romaji). */
export type WordRomanizationTrack = ((null | SyncedCueLine)[] | null)[];

const isBackgroundCue = (cue: SyncedCueLine, agents?: LyricAgent[]): boolean => {
    const role = agents?.find((agent) => agent.id === cue.agentId)?.role;
    return role === 'bg' || role === 'group';
};

/** Duet lines are right-aligned: every lead (main/voice) agent after the first. */
const secondaryLeadAgentIds = (agents?: LyricAgent[]): Set<string> => {
    const leadIds = (agents ?? [])
        .filter((agent) => agent.role === 'main' || agent.role === 'voice')
        .map((agent) => agent.id);
    return new Set(leadIds.slice(1));
};

const buildLineWords = (
    line: SynchronizedLyricLine,
    cues: SyncedCueLine[],
    romajiCues: (null | SyncedCueLine)[] | null | undefined,
    lineEndMs: number,
): LyricWord[] => {
    if (cues.length === 0) {
        return rubyTextToWords({ endMs: lineEndMs, startMs: line.startMs, text: line.text });
    }

    const words: LyricWord[] = [];

    cues.forEach((cue, cueIndex) => {
        const romajiCue = romajiCues?.[cueIndex];

        if (cue.words.length === 0) {
            words.push(
                ...rubyTextToWords({ endMs: cue.endMs, startMs: cue.startMs, text: cue.value }),
            );
            return;
        }

        cue.words.forEach((word, wordIndex) => {
            const converted = rubyTextToWords(word);
            const romanWord = romajiCue?.words[wordIndex]?.text;
            if (romanWord && converted.length > 0) {
                converted[0].romanWord = romanWord;
            }
            words.push(...converted);
        });
    });

    return words;
};

/**
 * Convert the domain lyrics model into AMLL lyric lines. Word-level cues become
 * per-word timings; plain LRC becomes a single word spanning the line (AMLL treats
 * a single word whose start equals the line start as line-level, not fake karaoke).
 * Background/group vocals become separate isBG lines; secondary lead agents become
 * right-aligned isDuet lines. Translation/romanization overlays attach per line.
 */
export const toAmllLyrics = ({
    agents,
    lyrics,
    romanization,
    translation,
    wordRomanization,
}: ToAmllLyricsOptions): LyricLine[] => {
    // Some providers emit lines out of time order; AMLL requires a monotonic
    // timeline and rejects any line whose endTime precedes its startTime. Sort
    // stably by start so the next-line end boundary never falls before the start.
    const lines = normalizeLyrics(lyrics).sort((a, b) => a.startMs - b.startMs);
    const duetIds = secondaryLeadAgentIds(agents);
    const result: LyricLine[] = [];

    lines.forEach((line, index) => {
        const nextStartMs = index + 1 < lines.length ? lines[index + 1].startMs : LAST_LINE_END_MS;
        const cues = line.cueLines ?? [];
        const bgCues = cues.filter((cue) => isBackgroundCue(cue, agents));
        const mainCues = cues.filter((cue) => !isBackgroundCue(cue, agents));
        const leadCues = mainCues.length > 0 ? mainCues : cues;
        const lineEndMs = Math.max(
            cues.length > 0 ? getLineEndMs(line) : nextStartMs,
            line.startMs,
        );
        const primaryAgentId = leadCues[0]?.agentId;

        result.push({
            endTime: lineEndMs,
            isBG: false,
            isDuet: primaryAgentId !== undefined && duetIds.has(primaryAgentId),
            romanLyric: findOverlayLineByTime(romanization, line.startMs, index) ?? '',
            startTime: line.startMs,
            translatedLyric: findOverlayLineByTime(translation, line.startMs, index) ?? '',
            words: buildLineWords(line, leadCues, wordRomanization?.[index], lineEndMs),
        });

        if (bgCues.length > 0 && mainCues.length > 0) {
            const bgStartMs = Math.min(...bgCues.map((cue) => cue.startMs));
            const bgEndMs = Math.max(lineEndMs, bgStartMs);
            result.push({
                endTime: bgEndMs,
                isBG: true,
                isDuet: false,
                romanLyric: '',
                startTime: bgStartMs,
                translatedLyric: '',
                words: buildLineWords(line, bgCues, null, bgEndMs),
            });
        }
    });

    return result;
};
