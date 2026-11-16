// SPDX-License-Identifier: AGPL-3.0-only
// Wire format and key verified against Folia (chthollyphile/folia-major), fixed commit
// ceb85eff9b9f72d9723236c3f43262eb1c3779ef, src/services/onlineMusic/kugou/krcDecrypt.ts.
// Folia is licensed under AGPL-3.0; this derivative work preserves that license.
//
// Kugou KRC decoding: strip the "krc1" header, XOR with a fixed 16-byte key, then inflate.

import { inflateSync } from 'node:zlib';

const KRC_KEY = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];

/** Decode a base64 KRC payload into plain KRC text. Throws on an invalid header. */
export const krcDecode = (base64Content: string): string => {
    const bytes = Buffer.from(base64Content, 'base64');

    if (bytes.subarray(0, 4).toString('ascii') !== 'krc1') {
        throw new Error('Unexpected KRC header');
    }

    const payload = bytes
        .subarray(4)
        .map((value, index) => value ^ KRC_KEY[index % KRC_KEY.length]);

    return inflateSync(payload).toString('utf8');
};
