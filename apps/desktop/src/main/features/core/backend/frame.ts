import { MAX_BACKEND_FRAME_BYTES } from '/@/shared/backend/constants';

export class BackendFrameDecoder {
    private body: Buffer | undefined;
    private header = Buffer.alloc(4);
    private offset = 0;

    finish(): void {
        if (this.body || this.offset) {
            throw new Error('Truncated backend frame');
        }
    }

    push(chunk: Buffer, receive: (value: unknown) => void): void {
        let cursor = 0;
        while (cursor < chunk.length) {
            const target = this.body ?? this.header;
            const length = Math.min(target.length - this.offset, chunk.length - cursor);
            chunk.copy(target, this.offset, cursor, cursor + length);
            cursor += length;
            this.offset += length;
            if (this.offset !== target.length) {
                continue;
            }
            this.offset = 0;
            if (this.body) {
                const value: unknown = JSON.parse(
                    new TextDecoder('utf-8', { fatal: true }).decode(this.body),
                );
                this.body = undefined;
                receive(value);
            } else {
                const size = this.header.readUInt32BE();
                if (!size || size > MAX_BACKEND_FRAME_BYTES) {
                    throw new Error('Invalid backend frame length');
                }
                this.body = Buffer.alloc(size);
            }
        }
    }
}

export function encodeBackendFrame(value: unknown): Buffer {
    const body = Buffer.from(JSON.stringify(value), 'utf8');
    if (!body.length || body.length > MAX_BACKEND_FRAME_BYTES) {
        throw new Error('Invalid backend frame length');
    }
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length);
    return Buffer.concat([header, body]);
}
