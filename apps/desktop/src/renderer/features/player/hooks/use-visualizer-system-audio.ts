import isElectron from 'is-electron';
import { useEffect, useRef } from 'react';

import i18n from '/@/i18n/i18n';
import { useWebAudio } from '/@/renderer/features/player/hooks/use-webaudio';
import { logger } from '/@/renderer/utils/logger';
import { toast } from '/@/shared/components/toast/toast';

export function useVisualizerSystemAudio({
    onSystemAudioCaptureSuccess,
    shouldAttemptConnection,
}: {
    onSystemAudioCaptureSuccess: () => void;
    shouldAttemptConnection: boolean;
}) {
    const { setWebAudio, webAudio } = useWebAudio();
    const currentContext = useRef(webAudio?.context);
    currentContext.current = webAudio?.context;
    const onSuccess = useRef(onSystemAudioCaptureSuccess);
    onSuccess.current = onSystemAudioCaptureSuccess;

    useEffect(() => {
        if (!isElectron() || !shouldAttemptConnection || !setWebAudio) return;
        let cancelled = false;
        let stream: MediaStream | undefined;
        let context: AudioContext | undefined;
        const connect = async () => {
            stream = await requestSystemAudio();
            if (cancelled || !stream.getAudioTracks().length) {
                stopCapture(stream);
                return;
            }

            context = new AudioContext({ latencyHint: 'playback' });
            const source = context.createMediaStreamSource(stream);
            currentContext.current = context;
            setWebAudio({ context, dsp: null, gains: [], visualizerInputs: [source] });
            await context.resume();
            if (!cancelled) onSuccess.current();
        };
        void connect().catch((error: unknown) => {
            if (cancelled) return;
            stopCapture(stream);
            reportCaptureError(error);
        });
        return () => {
            cancelled = true;
            stopCapture(stream);
            if (context) {
                void context
                    .close()
                    .catch((error: unknown) =>
                        logger.warn('System audio visualizer close failed', { error }),
                    );
                if (currentContext.current === context) setWebAudio(undefined);
            }
        };
    }, [setWebAudio, shouldAttemptConnection]);
}

function reportCaptureError(error: unknown): void {
    const name = (error as DOMException)?.name;
    if (name === 'NotAllowedError' || name === 'AbortError') {
        logger.debug('Visualizer system audio capture declined', { name });
        return;
    }
    toast.error({
        message: i18n.t('visualizer.systemAudioCaptureFailed', {
            message: (error as Error).message,
        }),
    });
}

function requestSystemAudio(): Promise<MediaStream> {
    return navigator.mediaDevices.getDisplayMedia({
        audio: {
            autoGainControl: false,
            channelCount: 2,
            echoCancellation: false,
            noiseSuppression: false,
        },
        video: Boolean(window.api?.utils?.isMacOS?.()),
    });
}

function stopCapture(stream: MediaStream | undefined): void {
    stream?.getTracks().forEach((track) => track.stop());
}
