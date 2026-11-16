import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { samples, toQrc } from './lyric-fixtures';
import { decryptQrcBytes, inflateQrcText, qrcDecrypt, qrcEncrypt } from './qrc-decrypt';

describe('inflateQrcText trailing-junk tolerance', () => {
    const plain = '[0,5000](0,2500)你好(2500,2500)世界';

    it('round-trips a clean zlib stream', () => {
        expect(inflateQrcText(deflateSync(Buffer.from(plain, 'utf8')))).toBe(plain);
    });

    it('tolerates trailing zero padding from 3DES block alignment', () => {
        const compressed = deflateSync(Buffer.from(plain, 'utf8'));
        const padded = Buffer.concat([compressed, Buffer.alloc(7)]);

        expect(inflateQrcText(padded)).toBe(plain);
    });

    it('tolerates arbitrary trailing junk after the stream end', () => {
        const compressed = deflateSync(Buffer.from(plain, 'utf8'));
        const padded = Buffer.concat([compressed, Buffer.from([1, 2, 3, 4])]);

        expect(inflateQrcText(padded)).toBe(plain);
    });
});

describe('decryptQrcBytes input handling', () => {
    it('parses a hex string into bytes', () => {
        expect(decryptQrcBytes('00ff10').length).toBe(3);
    });

    it('passes through a byte array', () => {
        expect(decryptQrcBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])).length).toBe(8);
    });

    it('rejects an empty hex payload', () => {
        expect(() => decryptQrcBytes('')).toThrow();
    });

    it('rejects an empty byte payload', () => {
        expect(() => decryptQrcBytes(new Uint8Array(0))).toThrow();
    });
});

describe('qrcEncrypt/qrcDecrypt full 3DES + zlib round-trip', () => {
    for (const lang of ['cn', 'en', 'jp'] as const) {
        it(`recovers ${lang} word-level QRC`, async () => {
            const text = toQrc(samples[lang]);

            expect(await qrcDecrypt(qrcEncrypt(text))).toBe(text);
        });
    }
});
