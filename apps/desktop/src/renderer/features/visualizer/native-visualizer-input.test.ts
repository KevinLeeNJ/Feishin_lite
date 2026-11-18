import { afterEach, expect, it, vi } from 'vitest';

import { createSilentAudioContext, NativeVisualizerInput } from './native-visualizer-input';

afterEach(() => vi.unstubAllGlobals());

it('requires a silent sink when creating an exclusive visualizer graph', () => {
    const close = vi.fn();
    const AudioContext = vi.fn(function () {
        return { close, sinkId: { type: 'none' } };
    });
    vi.stubGlobal('AudioContext', AudioContext);
    createSilentAudioContext();
    expect(AudioContext).toHaveBeenCalledWith({
        latencyHint: 'interactive',
        sinkId: { type: 'none' },
    });
    expect(close).not.toHaveBeenCalled();
});

it('closes the graph and signals a failure if Chromium ignores the silent sink', () => {
    const close = vi.fn();
    vi.stubGlobal(
        'AudioContext',
        vi.fn(function () {
            return { close, sinkId: '' };
        }),
    );
    expect(createSilentAudioContext).toThrow('Silent audio sink unavailable');
    expect(close).toHaveBeenCalledOnce();
});

it('feeds both PCM channels and flushes previously scheduled audio on seek', () => {
    const left = new Float32Array(1);
    const right = new Float32Array(1);
    const buffer = {
        duration: 1 / 48000,
        getChannelData: (channel: number) => (channel ? right : left),
    };
    const node = { connect: vi.fn() };
    const source = () => ({ connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() });
    const first = source();
    const second = source();
    const context = {
        createBuffer: vi.fn(() => buffer),
        createBufferSource: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second),
        createGain: vi.fn(() => node),
        currentTime: 10,
        destination: {},
        state: 'running',
    };
    const input = new NativeVisualizerInput(context as unknown as AudioContext);
    const chunk = { generation: 1, pcm: 'AIAAQA==', sampleRate: 48000 };
    input.push(chunk);
    expect(left[0]).toBe(-1);
    expect(right[0]).toBe(0.5);
    expect(context.createBuffer).toHaveBeenCalledWith(2, 1, 48000);
    expect(first.connect).toHaveBeenCalledWith(node);
    expect(first.start).toHaveBeenCalledWith(10.045);

    input.push({ ...chunk, generation: 2 });
    expect(first.stop).toHaveBeenCalledOnce();
    expect(first.disconnect).toHaveBeenCalledOnce();
    expect(second.start).toHaveBeenCalledWith(10.045);
});
