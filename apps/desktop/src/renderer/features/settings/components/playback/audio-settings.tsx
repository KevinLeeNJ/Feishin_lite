import { t } from 'i18next';
import isElectron from 'is-electron';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { NativeOutputSettings } from './native-output-settings';

import {
    SettingOption,
    SettingsSection,
} from '/@/renderer/features/settings/components/settings-section';
import { useCurrentServer, usePlayerStatus, useSettingsStore } from '/@/renderer/store';
import {
    usePlaybackSettings,
    usePlaybackType,
    useSettingsStoreActions,
} from '/@/renderer/store/settings.store';
import { logger } from '/@/renderer/utils/logger';
import { hasFeature } from '/@/shared/api/utils';
import { Select } from '/@/shared/components/select/select';
import { Switch } from '/@/shared/components/switch/switch';
import { toast } from '/@/shared/components/toast/toast';
import { ServerFeature } from '/@/shared/types/features-types';
import { PlayerStatus, PlayerType } from '/@/shared/types/types';

const ipc = isElectron() ? window.api.ipc : null;

export type AudioDeviceOption = { label: string; value: string };

export const getDefaultAudioDevice = (devices: AudioDeviceOption[]): null | string => {
    return devices.find((device) => device.value === 'default')?.value ?? devices[0]?.value ?? null;
};

export function selectAudioDestination(value: null | string): void {
    useSettingsStore.getState().actions.setSettings({
        playback:
            value === PlayerType.JUKEBOX
                ? { type: PlayerType.JUKEBOX }
                : { nativeAudioDeviceId: value ?? 'default', type: PlayerType.WEB },
    });
    ipc?.send('settings-set', {
        property: 'playbackType',
        value: value === PlayerType.JUKEBOX ? PlayerType.JUKEBOX : PlayerType.WEB,
    });
}

export const useAudioDevices = (playbackType: PlayerType) => {
    const [audioDevices, setAudioDevices] = useState<AudioDeviceOption[]>([]);
    const server = useCurrentServer();
    useEffect(() => {
        if (!isElectron()) {
            return;
        }
        let cancelled = false;
        const refresh = async () => {
            try {
                const { devices } = await window.api.hostBridge.backend.listOutputDevices();
                const options = [
                    { label: t('common.default'), value: 'default' },
                    ...devices.map((device) => ({ label: device.name, value: device.id })),
                    ...(hasFeature(server, ServerFeature.JUKEBOX)
                        ? [{ label: 'Jukebox', value: PlayerType.JUKEBOX }]
                        : []),
                ];
                if (!cancelled) {
                    setAudioDevices(options);
                }
            } catch (error) {
                logger.error('Failed to enumerate native audio devices', { error });
                if (!cancelled) {
                    toast.error({ message: t('error.audioDeviceFetchError') });
                }
            }
        };
        void refresh();
        navigator.mediaDevices?.addEventListener('devicechange', refresh);
        return () => {
            cancelled = true;
            navigator.mediaDevices?.removeEventListener('devicechange', refresh);
        };
    }, [playbackType, server]);
    return audioDevices;
};

export const AudioSettings = memo(() => {
    const { t } = useTranslation();
    const settings = usePlaybackSettings();
    const { setSettings } = useSettingsStoreActions();
    const status = usePlayerStatus();
    const playbackType = usePlaybackType();

    // Cleaned up server feature logic via requested hooks/utilities
    const currentServer = useCurrentServer();
    const isJukeboxSupported = hasFeature(currentServer, ServerFeature.JUKEBOX);

    const audioDevices = useAudioDevices(playbackType);
    const audioDeviceId =
        playbackType === PlayerType.JUKEBOX ? PlayerType.JUKEBOX : settings.nativeAudioDeviceId;
    const isCasting = settings.type === PlayerType.DLNA;

    const selectData = [
        { label: 'Web', value: PlayerType.WEB },
        ...(isJukeboxSupported ? [{ label: 'Jukebox', value: PlayerType.JUKEBOX }] : []),
    ];

    const audioOptions: SettingOption[] = [
        {
            control: (
                <Select
                    data={selectData}
                    disabled={status === PlayerStatus.PLAYING || isCasting}
                    onChange={(value) => {
                        setSettings({ playback: { type: value as PlayerType } });
                    }}
                    value={settings.type}
                />
            ),
            description: t('setting.audioPlayer', { context: 'description' }),
            isHidden: isElectron() || !isJukeboxSupported,
            note: status === PlayerStatus.PLAYING ? t('common.playerMustBePaused') : undefined,
            title: t('setting.audioPlayer'),
        },
        {
            control: (
                <Select
                    clearable
                    data={audioDevices}
                    disabled={!isElectron()}
                    onChange={selectAudioDestination}
                    value={audioDeviceId ?? getDefaultAudioDevice(audioDevices)}
                />
            ),
            description: t('setting.audioDevice', { context: 'description' }),
            isHidden: !isElectron(),
            title: t('setting.audioDevice'),
        },
        {
            control: (
                <Switch
                    defaultChecked={settings.webAudio}
                    onChange={(e) => {
                        setSettings({
                            playback: { webAudio: e.currentTarget.checked },
                        });
                    }}
                />
            ),
            description: t('setting.webAudio', { context: 'description' }),
            isHidden: settings.type !== PlayerType.WEB,
            note: t('common.restartRequired'),
            title: t('setting.webAudio'),
        },
        {
            control: (
                <Switch
                    defaultChecked={settings.preservePitch}
                    onChange={(e) => {
                        setSettings({
                            playback: { preservePitch: e.currentTarget.checked },
                        });
                    }}
                />
            ),
            description: t('setting.preservePitch', { context: 'description' }),
            isHidden: settings.type !== PlayerType.WEB,
            title: t('setting.preservePitch'),
        },
        {
            control: (
                <Switch
                    defaultChecked={settings.audioFadeOnStatusChange}
                    onChange={(e) => {
                        setSettings({
                            playback: { audioFadeOnStatusChange: e.currentTarget.checked },
                        });
                    }}
                />
            ),
            description: t('setting.audioFadeOnStatusChange', { context: 'description' }),
            title: t('setting.audioFadeOnStatusChange'),
        },
    ];

    return (
        <>
            <SettingsSection options={audioOptions} title={t('page.setting.audio')} />
            {isElectron() && !isCasting && playbackType !== PlayerType.JUKEBOX && (
                <NativeOutputSettings />
            )}
        </>
    );
});
