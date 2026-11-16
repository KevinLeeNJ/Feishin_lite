import { describe, expect, it } from 'vitest';

import { krcDecode } from './krc-decode';
import { encodeKrc, lineText, samples, toKrc } from './lyric-fixtures';
import { buildProviderResult } from './result';

import { parseKrc } from '/@/shared/lyrics';
import { LyricSource } from '/@/shared/types/domain-types';

const classify = (raw: string) =>
    buildProviderResult({
        artist: '',
        name: '',
        parsed: parseKrc(raw),
        rawText: raw,
        remoteId: 'fixture',
        source: LyricSource.KUGOU,
        sourceFormat: 'krc',
    });

describe('krcDecode wire format', () => {
    for (const lang of ['cn', 'en', 'jp'] as const) {
        it(`decodes ${lang} word-level KRC (krc1 + XOR + zlib)`, () => {
            const text = toKrc(samples[lang]);

            expect(krcDecode(encodeKrc(text))).toBe(text);
        });
    }

    it('rejects an invalid header', () => {
        const bad = Buffer.concat([Buffer.from('xxxx'), Buffer.alloc(8)]).toString('base64');

        expect(() => krcDecode(bad)).toThrow('Unexpected KRC header');
    });
});

describe('KRC granularity classification', () => {
    for (const lang of ['cn', 'en', 'jp'] as const) {
        it(`classifies ${lang} word-level KRC as word`, () => {
            const result = classify(krcDecode(encodeKrc(toKrc(samples[lang]))));

            expect(result.lyrics.timingGranularity).toBe('word');
            expect(result.lyrics.lyrics).toHaveLength(2);
        });
    }

    it('classifies line-level KRC (no word tags) as line', () => {
        const lineLevel = samples.cn
            .map((line) => `[${line.startMs},${line.durMs}]${lineText(line)}`)
            .join('\n');
        const result = classify(krcDecode(encodeKrc(lineLevel)));

        expect(result.lyrics.timingGranularity).toBe('line');
    });
});
