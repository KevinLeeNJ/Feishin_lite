import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { BackendFrameDecoder, encodeBackendFrame } from './frame';

import { BACKEND_PROTOCOL_VERSION } from '/@/shared/backend/constants';
import { BackendMethod, backendResponseSchema, BackendResult } from '/@/shared/backend/protocol';

type Pending = {
    method: BackendMethod;
    reject: (error: Error) => void;
    resolve: (result: BackendResult) => void;
    timer: ReturnType<typeof setTimeout>;
};

export class BackendClient {
    get isRunning(): boolean {
        return !this.failure && !this.stopping;
    }
    private child: ChildProcessWithoutNullStreams;
    private closed: Promise<void>;
    private failure: Error | undefined;
    private pending = new Map<string, Pending>();
    private sessionId: string | undefined;
    private shutdown: Promise<void> | undefined;

    private stopping = false;

    private constructor(
        executable: string,
        reportDiagnostic: () => void,
        private timeoutMs: number,
    ) {
        this.child = spawn(executable, [], { stdio: 'pipe', windowsHide: true });
        const decoder = new BackendFrameDecoder();
        this.closed = new Promise((resolve) => {
            this.child.once('close', () => {
                try {
                    decoder.finish();
                    this.fail(new Error('Backend process closed'));
                } catch {
                    this.fail(new Error('Truncated backend response'));
                }
                resolve();
            });
        });
        this.child.once('error', () => this.fail(new Error('Backend process failed to start')));
        this.child.stdin.on('error', () => this.fail(new Error('Backend input closed')));
        this.child.stdout.on('data', (chunk: Buffer) => {
            try {
                decoder.push(chunk, (value) => this.receive(value));
            } catch {
                this.fail(new Error('Invalid backend response'));
            }
        });
        // Report diagnostics once, without forwarding untrusted text or stream credentials.
        this.child.stderr.once('data', reportDiagnostic);
        this.child.stderr.resume();
    }

    static async start(
        executable: string,
        reportDiagnostic: () => void,
        timeoutMs = 5000,
    ): Promise<BackendClient> {
        const client = new BackendClient(executable, reportDiagnostic, timeoutMs);
        try {
            await client.request('hello');
            return client;
        } catch (error) {
            await client.stop();
            throw error;
        }
    }

    request<M extends BackendMethod>(
        method: M,
        params?: unknown,
    ): Promise<Extract<BackendResult, { method: M }>> {
        if (this.failure || this.stopping) {
            return Promise.reject(this.failure ?? new Error('Backend is stopping'));
        }
        if (this.pending.size >= 32) {
            return Promise.reject(new Error('Backend request limit exceeded'));
        }
        const requestId = randomUUID();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => this.fail(new Error('Backend request timed out')),
                this.timeoutMs,
            );
            this.pending.set(requestId, {
                method,
                reject,
                resolve: resolve as Pending['resolve'],
                timer,
            });
            this.child.stdin.write(
                encodeBackendFrame({
                    method,
                    protocolVersion: BACKEND_PROTOCOL_VERSION,
                    requestId,
                    ...(params === undefined ? {} : { params }),
                }),
            );
        });
    }

    stop(): Promise<void> {
        this.shutdown ??= this.shutdownProcess();
        return this.shutdown;
    }

    private fail(error: Error): void {
        this.failure ??= error;
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(this.failure);
        }
        this.pending.clear();
        this.child.kill();
    }

    private receive(value: unknown): void {
        const response = backendResponseSchema.parse(value);
        const pending = this.pending.get(response.requestId);
        if (!pending || (this.sessionId && response.sessionId !== this.sessionId)) {
            throw new Error('Unexpected backend response');
        }
        if ('result' in response && response.result.method !== pending.method) {
            throw new Error('Unexpected backend result');
        }
        this.sessionId ??= response.sessionId;
        this.pending.delete(response.requestId);
        clearTimeout(pending.timer);
        if ('error' in response) {
            pending.reject(new Error(`Backend ${response.error.code}: ${response.error.message}`));
        } else {
            pending.resolve(response.result);
        }
    }

    private async shutdownProcess(): Promise<void> {
        const shutdown = this.failure ? Promise.resolve() : this.request('shutdown');
        this.stopping = true;
        try {
            await shutdown;
        } finally {
            this.child.stdin.end();
            const timer = setTimeout(() => this.child.kill(), 1000);
            await this.closed;
            clearTimeout(timer);
        }
    }
}
