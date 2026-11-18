import { VisualizerSamples } from '/@/shared/backend/audio';

const START_DELAY = 0.045;
const MAX_LEAD = 0.15;
const STEREO_FRAME_BYTES = 4;
const SILENT_SINK = { type: 'none' } as const;

export class NativeVisualizerInput {
    readonly node: GainNode;
    private generation: number | undefined;
    private nextTime = 0;
    private sources = new Set<AudioBufferSourceNode>();

    constructor(private context: AudioContext) {
        this.node = context.createGain();
        this.node.connect(context.destination);
    }

    push(samples: VisualizerSamples): void {
        if (this.context.state !== 'running') return;
        const now = this.context.currentTime;
        if (this.generation !== samples.generation || this.nextTime > now + MAX_LEAD) {
            this.reset();
        }
        this.generation = samples.generation;
        const buffer = decodeStereoPcm(this.context, samples);
        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.node);
        this.sources.add(source);
        source.onended = () => {
            source.disconnect();
            this.sources.delete(source);
        };
        const start = this.nextTime > now ? this.nextTime : now + START_DELAY;
        source.start(start);
        this.nextTime = start + buffer.duration;
    }

    reset(): void {
        for (const source of this.sources) {
            source.onended = null;
            source.stop();
            source.disconnect();
        }
        this.sources.clear();
        this.nextTime = 0;
    }
}

export function createSilentAudioContext(): AudioContext {
    const options = { latencyHint: 'interactive' as const, sinkId: SILENT_SINK };
    const context = new AudioContext(options) as AudioContext & { sinkId?: { type: string } };
    if (context.sinkId?.type !== 'none') {
        void context.close();
        throw new Error('Silent audio sink unavailable');
    }
    return context;
}

export function supportsSilentAudioContext(): boolean {
    return typeof AudioContext !== 'undefined' && 'sinkId' in AudioContext.prototype;
}

function decodeStereoPcm(
    context: AudioContext,
    { pcm, sampleRate }: VisualizerSamples,
): AudioBuffer {
    const bytes = atob(pcm);
    if (!bytes.length || bytes.length % STEREO_FRAME_BYTES !== 0) {
        throw new Error('Invalid stereo PCM packet');
    }
    const buffer = context.createBuffer(2, bytes.length / STEREO_FRAME_BYTES, sampleRate);
    for (let channel = 0; channel < 2; channel++) {
        const target = buffer.getChannelData(channel);
        for (let i = 0; i < target.length; i++) {
            const offset = i * STEREO_FRAME_BYTES + channel * 2;
            const signed =
                ((bytes.charCodeAt(offset) | (bytes.charCodeAt(offset + 1) << 8)) << 16) >> 16;
            target[i] = signed / 32768;
        }
    }
    return buffer;
}
