import { describe, expect, it } from 'vitest';

import { BackendFrameDecoder, encodeBackendFrame } from './frame';

import { MAX_BACKEND_FRAME_BYTES } from '/@/shared/backend/constants';

describe('backend frame boundaries', () => {
    it('accepts every split point and joined UTF-8 frames', () => {
        const values = [{ text: '设备🎵' }, { method: 'health' }];
        const bytes = Buffer.concat(values.map(encodeBackendFrame));
        for (let split = 0; split <= bytes.length; split++) {
            const decoder = new BackendFrameDecoder();
            const received: unknown[] = [];
            decoder.push(bytes.subarray(0, split), (value) => received.push(value));
            decoder.push(bytes.subarray(split), (value) => received.push(value));
            decoder.finish();
            expect(received).toEqual(values);
        }
    });

    it('rejects zero and oversized frames before allocating a body', () => {
        for (const size of [0, MAX_BACKEND_FRAME_BYTES + 1, 0xffffffff]) {
            const header = Buffer.alloc(4);
            header.writeUInt32BE(size);
            expect(() => new BackendFrameDecoder().push(header, () => {})).toThrow('length');
        }
        expect(() => encodeBackendFrame('x'.repeat(MAX_BACKEND_FRAME_BYTES))).toThrow('length');
    });

    it('rejects invalid JSON and incomplete headers or bodies', () => {
        const bytes = encodeBackendFrame({ text: 'test' });
        for (let length = 1; length < bytes.length; length++) {
            const decoder = new BackendFrameDecoder();
            decoder.push(bytes.subarray(0, length), () => {});
            expect(() => decoder.finish()).toThrow('Truncated');
        }
        expect(() =>
            new BackendFrameDecoder().push(Buffer.from([0, 0, 0, 1, 0]), () => {}),
        ).toThrow();
    });
});
