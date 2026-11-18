import isElectron from 'is-electron';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsLocalVisualizerSurfaceVisible } from '/@/renderer/features/player/hooks/use-is-local-visualizer-surface-visible';
import {
    useVisualizerExclusiveBlocked,
    useVisualizerExclusiveMode,
} from '/@/renderer/features/player/hooks/use-visualizer-exclusive-blocked';
import { useVisualizerSystemAudio } from '/@/renderer/features/player/hooks/use-visualizer-system-audio';
import { closeLocalVisualizerSurfaces } from '/@/renderer/features/player/utils/close-local-visualizer-surfaces';
import { NativeVisualizerBridge } from '/@/renderer/features/visualizer/components/native-visualizer-bridge';
import { setNativeVisualizerFailed } from '/@/renderer/features/visualizer/native-visualizer-status';
import { useFullScreenPlayerStore, usePlaybackType } from '/@/renderer/store';
import { isClientPlayback } from '/@/shared/backend/playback-target';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Modal } from '/@/shared/components/modal/modal';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { useDisclosure } from '/@/shared/hooks/use-disclosure';

const CONSENT_GRANTED_KEY = 'visualizer_system_audio_consent_granted';

type PromptState = 'loading' | { consent: boolean };

export function VisualizerSystemAudioBridgeHook() {
    const playbackType = usePlaybackType();
    const exclusive = useVisualizerExclusiveMode();
    const blocked = useVisualizerExclusiveBlocked();
    const isVisualizerSurfaceVisible = useIsLocalVisualizerSurfaceVisible();

    useEffect(() => {
        if (!isElectron()) {
            return;
        }

        const shouldReportVisible =
            isClientPlayback(playbackType) && isVisualizerSurfaceVisible && !exclusive;

        window.api.visualizer.setLocalSurfaceVisible(shouldReportVisible);

        return () => {
            window.api.visualizer.setLocalSurfaceVisible(false);
        };
    }, [exclusive, playbackType, isVisualizerSurfaceVisible]);

    if (!isElectron() || !isClientPlayback(playbackType)) {
        return null;
    }

    return (
        <>
            <VisualizerSystemAudioBridge />
            {exclusive && !blocked && isVisualizerSurfaceVisible && <NativeVisualizerBridge />}
        </>
    );
}

function VisualizerSystemAudioBridge() {
    const { t } = useTranslation();
    const playbackType = usePlaybackType();
    const exclusive = useVisualizerExclusiveMode();
    const blocked = useVisualizerExclusiveBlocked();
    const isVisualizerSurfaceVisible = useIsLocalVisualizerSurfaceVisible();
    const [promptState, setPromptState] = useState<PromptState>('loading');
    const [sessionAllowCapture, setSessionAllowCapture] = useState(false);
    const [isPromptOpen, { close: closePrompt, open: openPrompt, toggle: togglePrompt }] =
        useDisclosure(false);

    const persistConsent = useCallback((granted: boolean) => {
        if (!isElectron() || !window.api.localSettings) {
            return;
        }
        window.api.localSettings.set(CONSENT_GRANTED_KEY, granted);
    }, []);

    useEffect(() => {
        if (!isElectron() || !window.api.localSettings) {
            setPromptState({ consent: false });
            return;
        }

        let cancelled = false;
        (async () => {
            const ls = window.api.localSettings!;
            const consent = Boolean(await ls.get(CONSENT_GRANTED_KEY));
            if (!cancelled) {
                setPromptState({ consent });
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    const eligibleForPrompt =
        isElectron() &&
        isClientPlayback(playbackType) &&
        !exclusive &&
        isVisualizerSurfaceVisible &&
        promptState !== 'loading' &&
        !promptState.consent &&
        !sessionAllowCapture;

    useEffect(() => {
        if (eligibleForPrompt) {
            openPrompt();
        } else {
            closePrompt();
        }
    }, [eligibleForPrompt, closePrompt, openPrompt]);

    useEffect(() => {
        if (!blocked) return;
        const fullScreen = useFullScreenPlayerStore.getState();
        if (fullScreen.visualizerExpanded) {
            fullScreen.actions.setStore({
                expanded: fullScreen.visualizerReturnToPlayer,
                visualizerExpanded: false,
                visualizerReturnToPlayer: false,
            });
        }
    }, [blocked]);

    useEffect(() => {
        if (!exclusive) setNativeVisualizerFailed(false);
    }, [exclusive]);

    const shouldAttemptConnection =
        isElectron() &&
        isClientPlayback(playbackType) &&
        !exclusive &&
        isVisualizerSurfaceVisible &&
        promptState !== 'loading' &&
        (promptState.consent || sessionAllowCapture);

    const handleCaptureSuccess = useCallback(() => {
        persistConsent(true);
        setPromptState({ consent: true });
        setSessionAllowCapture(false);
    }, [persistConsent]);

    useVisualizerSystemAudio({
        onSystemAudioCaptureSuccess: handleCaptureSuccess,
        shouldAttemptConnection,
    });

    const handleAllow = useCallback(() => {
        persistConsent(true);
        setPromptState({ consent: true });
        setSessionAllowCapture(true);
    }, [persistConsent]);

    const handleDecline = useCallback(() => {
        persistConsent(false);
        setPromptState({ consent: false });
        setSessionAllowCapture(false);
        closeLocalVisualizerSurfaces();
        closePrompt();
    }, [closePrompt, persistConsent]);

    if (!isElectron() || !isClientPlayback(playbackType)) {
        return null;
    }

    return (
        <Modal
            closeOnClickOutside={false}
            closeOnEscape={false}
            handlers={{ close: closePrompt, open: openPrompt, toggle: togglePrompt }}
            opened={isPromptOpen}
            size="md"
            title={t('visualizer.systemAudioConsentTitle')}
            withCloseButton={false}
        >
            <Stack gap="lg">
                <Text size="sm">{t('visualizer.systemAudioConsentBody')}</Text>
                <Group justify="flex-end">
                    <Button onClick={handleDecline} variant="default">
                        {t('visualizer.systemAudioConsentDecline')}
                    </Button>
                    <Button onClick={handleAllow} variant="filled">
                        {t('visualizer.systemAudioConsentAllow')}
                    </Button>
                </Group>
            </Stack>
        </Modal>
    );
}
