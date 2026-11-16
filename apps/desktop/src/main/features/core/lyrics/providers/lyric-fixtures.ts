// Synthetic multilingual lyric fixtures for offline regression tests. The text is original
// placeholder content (not real provider lyrics), encoded in each provider's real wire format
// so the decode -> parse -> normalize pipeline is exercised without network or persisted lyrics.
import { deflateSync } from 'node:zlib';

export type FixtureLine = { durMs: number; startMs: number; words: FixtureWord[] };
export type FixtureWord = { durMs: number; startMs: number; text: string };

export const samples: Record<'cn' | 'en' | 'jp', FixtureLine[]> = {
    cn: [
        {
            durMs: 5000,
            startMs: 0,
            words: [
                { durMs: 2500, startMs: 0, text: '你好' },
                { durMs: 2500, startMs: 2500, text: '世界' },
            ],
        },
        { durMs: 3000, startMs: 5000, words: [{ durMs: 3000, startMs: 5000, text: '测试歌词' }] },
    ],
    en: [
        {
            durMs: 5000,
            startMs: 0,
            words: [
                { durMs: 2500, startMs: 0, text: 'Hello ' },
                { durMs: 2500, startMs: 2500, text: 'world' },
            ],
        },
        {
            durMs: 3000,
            startMs: 5000,
            words: [{ durMs: 3000, startMs: 5000, text: 'test lyrics' }],
        },
    ],
    jp: [
        {
            durMs: 5000,
            startMs: 0,
            words: [
                { durMs: 2500, startMs: 0, text: 'こんにちは' },
                { durMs: 2500, startMs: 2500, text: '世界' },
            ],
        },
        { durMs: 3000, startMs: 5000, words: [{ durMs: 3000, startMs: 5000, text: '二行目' }] },
    ],
};

export const lineText = (line: FixtureLine): string => line.words.map((word) => word.text).join('');

/** QRC word-level: [start,duration] line tag + (start,duration) absolute word tags (trailing text). */
export const toQrc = (lines: FixtureLine[]): string =>
    lines
        .map(
            (line) =>
                `[${line.startMs},${line.durMs}]` +
                line.words.map((word) => `(${word.startMs},${word.durMs})${word.text}`).join(''),
        )
        .join('\n');

/** YRC word-level: [start,duration] line tag + (start,duration,flag) absolute word tags. */
export const toYrc = (lines: FixtureLine[]): string =>
    lines
        .map(
            (line) =>
                `[${line.startMs},${line.durMs}]` +
                line.words.map((word) => `(${word.startMs},${word.durMs},0)${word.text}`).join(''),
        )
        .join('\n');

/** KRC word-level: [start,duration] line tag + <offset,duration> word tags relative to the line. */
export const toKrc = (lines: FixtureLine[]): string =>
    lines
        .map(
            (line) =>
                `[${line.startMs},${line.durMs}]` +
                line.words
                    .map((word) => `<${word.startMs - line.startMs},${word.durMs}>${word.text}`)
                    .join(''),
        )
        .join('\n');

const lrcTag = (ms: number): string => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const fraction = Math.round((ms % 1000) / 10);
    const pad = (value: number) => String(value).padStart(2, '0');

    return `[${pad(minutes)}:${pad(seconds)}.${pad(fraction)}]`;
};

/** Line-level LRC: [mm:ss.xx] tags, no word timing. */
export const toLrc = (lines: FixtureLine[]): string =>
    lines.map((line) => `${lrcTag(line.startMs)}${lineText(line)}`).join('\n');

const KRC_KEY = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];

/** Encode KRC wire format: "krc1" header + XOR(16-byte key) over zlib-deflated text, base64. */
export const encodeKrc = (text: string): string => {
    const compressed = deflateSync(Buffer.from(text, 'utf8'));
    const xored = Buffer.from(
        compressed.map((byte, index) => byte ^ KRC_KEY[index % KRC_KEY.length]),
    );

    return Buffer.concat([Buffer.from('krc1', 'ascii'), xored]).toString('base64');
};
