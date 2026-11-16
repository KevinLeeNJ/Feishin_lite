import type {
    AudioCommand,
    AudioSettings,
    AudioSnapshot,
    AudioTrack,
} from '/@/shared/backend/audio';

export interface RustPlaybackPort {
    command(command: AudioCommand): Promise<void>;
    snapshot(): Promise<AudioSnapshot>;
}

export class RustPlaybackSession {
    private disposed = false;
    private epoch = 0;
    private generation = 0;
    private instanceId: string | undefined;
    private loaded = false;
    private paused = true;
    private position = 0;
    private revision = 0;
    private settings: AudioSettings | undefined;

    constructor(private port: RustPlaybackPort) {}

    async configure(settings: AudioSettings): Promise<void> {
        if (
            this.settings?.deviceId !== settings.deviceId ||
            this.settings?.sampleRate !== settings.sampleRate ||
            this.settings?.exclusive !== settings.exclusive
        ) {
            this.epoch++;
        }
        this.settings = settings;
        if (this.loaded && !this.disposed) {
            await this.port.command({ method: 'configure', params: settings });
        }
    }

    async dispose(): Promise<void> {
        this.disposed = true;
        await this.stop();
    }

    async load(
        track: Omit<AudioTrack, 'instanceId' | 'queueRevision' | 'url'>,
        resolveUrl: () => Promise<string>,
        position: number,
        paused: boolean,
        settings: AudioSettings,
    ): Promise<void> {
        const generation = ++this.generation;
        this.loaded = false;
        this.position = position;
        this.paused = paused;
        this.settings = settings;
        try {
            const url = await resolveUrl();
            if (this.disposed || generation !== this.generation) {
                return;
            }
            await this.commitLoad(track, url, generation);
        } catch (error) {
            if (this.disposed || generation !== this.generation) {
                return;
            }
            throw error;
        }
    }

    async pause(paused: boolean): Promise<void> {
        this.paused = paused;
        if (this.loaded && !this.disposed) {
            await this.port.command({ method: 'setPaused', params: { paused } });
        }
    }

    async poll(): Promise<AudioSnapshot | undefined> {
        if (!this.loaded || this.disposed) {
            return;
        }
        const generation = this.generation;
        const epoch = this.epoch;
        const snapshot = await this.port.snapshot();
        if (
            this.disposed ||
            generation !== this.generation ||
            epoch !== this.epoch ||
            snapshot.instanceId !== this.instanceId ||
            snapshot.queueRevision !== this.revision
        ) {
            return;
        }
        return snapshot;
    }

    async restart(position: number, paused: boolean): Promise<void> {
        this.paused = paused;
        await this.seek(position);
        await this.pause(this.paused);
    }

    async seek(position: number): Promise<void> {
        this.epoch++;
        this.position = position;
        if (this.loaded && !this.disposed) {
            await this.port.command({ method: 'seek', params: { position } });
        }
    }

    async stop(): Promise<void> {
        this.generation++;
        this.loaded = false;
        this.instanceId = undefined;
        await this.port.command({ method: 'stop' });
    }

    private async commitLoad(
        track: Omit<AudioTrack, 'instanceId' | 'queueRevision' | 'url'>,
        url: string,
        generation: number,
    ): Promise<void> {
        this.instanceId = crypto.randomUUID();
        const start = this.position;
        await this.port.command({
            method: 'load',
            params: {
                paused: this.paused,
                settings: this.settings!,
                start: this.position,
                track: {
                    ...track,
                    instanceId: this.instanceId,
                    queueRevision: ++this.revision,
                    url,
                },
            },
        });
        if (!this.disposed && generation === this.generation) {
            this.loaded = true;
            await this.configure(this.settings!);
            await this.pause(this.paused);
            if (start !== this.position) {
                await this.seek(this.position);
            }
        }
    }
}
