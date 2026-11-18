import { useEffect, useRef } from 'react';

import { useWebAudio } from '/@/renderer/features/player/hooks/use-webaudio';
import {
    createSilentAudioContext,
    NativeVisualizerInput,
} from '/@/renderer/features/visualizer/native-visualizer-input';
import { setNativeVisualizerFailed } from '/@/renderer/features/visualizer/native-visualizer-status';
import { logger } from '/@/renderer/utils/logger';
import { VisualizerSamples } from '/@/shared/backend/audio';

const POLL_INTERVAL = 30;

export function NativeVisualizerBridge() {
    const { setWebAudio, webAudio } = useWebAudio();
    const currentContext = useRef(webAudio?.context);
    currentContext.current = webAudio?.context;

    useEffect(() => {
        if (!setWebAudio) return;

        let context: AudioContext;
        try {
            context = createSilentAudioContext();
        } catch (error) {
            handleFailure(error);
            return;
        }
        const input = new NativeVisualizerInput(context);
        currentContext.current = context;
        setWebAudio({ context, dsp: null, gains: [], visualizerInputs: [input.node] });
        const stop = pollSamples(window.api.hostBridge.audio.visualizerSamples, (samples) => {
            if (samples) input.push(samples);
        });
        void context.resume().catch((error: unknown) => {
            if (context.state !== 'closed') handleFailure(error);
        });
        return () => {
            stop();
            input.reset();
            input.node.disconnect();
            void context
                .close()
                .catch((error: unknown) => logger.warn('Visualizer close failed', { error }));
            if (currentContext.current === context) setWebAudio(undefined);
        };
    }, [setWebAudio]);
    return null;
}

function handleFailure(error: unknown): void {
    logger.warn('Native visualizer unavailable', { error });
    setNativeVisualizerFailed(true);
}

function pollSamples(
    read: () => Promise<null | VisualizerSamples>,
    consume: (samples: null | VisualizerSamples) => void,
): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
        try {
            const samples = await read();
            if (!stopped) {
                consume(samples);
                timer = setTimeout(() => void poll(), POLL_INTERVAL);
            }
        } catch (error) {
            if (!stopped) handleFailure(error);
        }
    }
    void poll();
    return () => {
        stopped = true;
        clearTimeout(timer);
    };
}
