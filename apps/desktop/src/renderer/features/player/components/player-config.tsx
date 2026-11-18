import isElectron from 'is-electron';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { PitchControls, PlaybackSpeedSlider } from './playback-speed-controls';

import { eventEmitter } from '/@/renderer/events/event-emitter';
import {
    CrossfadeDurationConfig,
    CrossfadeStyleConfig,
    TransitionTypeConfig,
} from '/@/renderer/features/player/components/transition-config';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { useVisualizerExclusiveBlocked } from '/@/renderer/features/player/hooks/use-visualizer-exclusive-blocked';
import {
    getDefaultAudioDevice,
    selectAudioDestination,
    useAudioDevices,
} from '/@/renderer/features/settings/components/playback/audio-settings';
import {
    ListConfigBooleanControl,
    ListConfigTable,
} from '/@/renderer/features/shared/components/list-config-menu';
import { usePlaybackType, usePlayerProperties, usePlayerStatus } from '/@/renderer/store';
import {
    useCombinedLyricsAndVisualizer,
    usePlaybackSettings,
    useSettingsStore,
    useSettingsStoreActions,
    useShowLyricsInSidebar,
    useShowQueueInSidebar,
    useShowVisualizerInSidebar,
} from '/@/renderer/store/settings.store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Group } from '/@/shared/components/group/group';
import { Paper } from '/@/shared/components/paper/paper';
import { Popover } from '/@/shared/components/popover/popover';
import { Select } from '/@/shared/components/select/select';
import { Stack } from '/@/shared/components/stack/stack';
import { PlayerStatus, PlayerStyle, PlayerType } from '/@/shared/types/types';

const ipc = isElectron() ? window.api.ipc : null;

export const PlayerConfig = () => {
    const { t } = useTranslation();
    const preservePitch = useSettingsStore((state) => state.playback.preservePitch);
    const showLyricsInSidebar = useShowLyricsInSidebar();
    const showQueueInSidebar = useShowQueueInSidebar();
    const showVisualizerInSidebar = useShowVisualizerInSidebar();
    const combinedLyricsAndVisualizer = useCombinedLyricsAndVisualizer();
    const { transitionType } = usePlayerProperties();
    const visualizerBlocked = useVisualizerExclusiveBlocked();

    const playbackSettings = usePlaybackSettings();
    const { setSettings } = useSettingsStoreActions();

    const setPreservePitch = useCallback(
        (value: boolean) => {
            setSettings({
                playback: { ...playbackSettings, preservePitch: value },
            });
        },
        [playbackSettings, setSettings],
    );

    const audioOptions = useMemo(
        () => [
            {
                component: <AudioPlayerTypeConfig />,
                id: 'audioPlayerType',
                isHidden: isElectron(),
                label: t('setting.audioPlayer'),
            },
            {
                component: <AudioDeviceConfig />,
                id: 'audioDevice',
                label: t('setting.audioDevice'),
            },
        ],
        [t],
    );

    const transitionOptions = useMemo(
        () => [
            {
                component: <TransitionTypeConfig />,
                id: 'transitionType',
                label: t('setting.playbackStyle'),
            },
            {
                component: <CrossfadeStyleConfig />,
                id: 'crossfadeStyle',
                isHidden: transitionType !== PlayerStyle.CROSSFADE,
                label: t('setting.crossfadeStyle'),
            },
            {
                component: <CrossfadeDurationConfig />,
                id: 'crossfadeDuration',
                isHidden: transitionType !== PlayerStyle.CROSSFADE,
                label: t('setting.crossfadeDuration'),
            },
        ],
        [t, transitionType],
    );

    const playbackOptions = useMemo(
        () => [
            {
                component: <PlaybackSpeedSlider />,
                id: 'playbackSpeed',
                label: t('player.playbackSpeed'),
            },
            {
                component: <PitchControls />,
                id: 'pitchControls',
                isHidden: preservePitch,
                label: '',
            },
            {
                component: (
                    <ListConfigBooleanControl onChange={setPreservePitch} value={preservePitch} />
                ),
                id: 'preservePitch',
                label: t('setting.preservePitch'),
            },
        ],
        [preservePitch, setPreservePitch, t],
    );

    const sidebarOptions = useMemo(
        () => [
            {
                component: (
                    <ListConfigBooleanControl
                        onChange={(value) => {
                            setSettings({
                                general: {
                                    showQueueInSidebar: value,
                                },
                            });
                        }}
                        value={showQueueInSidebar}
                    />
                ),
                id: 'showQueueInSidebar',
                label: t('setting.showQueueInSidebar'),
            },
            {
                component: (
                    <ListConfigBooleanControl
                        onChange={(value) => {
                            setSettings({
                                general: {
                                    showLyricsInSidebar: value,
                                },
                            });
                        }}
                        value={showLyricsInSidebar}
                    />
                ),
                id: 'showLyricsInSidebar',
                label: t('setting.showLyricsInSidebar'),
            },
            {
                component: (
                    <ListConfigBooleanControl
                        description={
                            visualizerBlocked ? t('visualizer.exclusiveUnavailable') : undefined
                        }
                        disabled={visualizerBlocked}
                        onChange={(value) => {
                            setSettings({
                                general: {
                                    showVisualizerInSidebar: value,
                                },
                            });
                        }}
                        value={showVisualizerInSidebar}
                    />
                ),
                id: 'showVisualizerInSidebar',
                label: t('setting.showVisualizerInSidebar'),
            },
            {
                component: (
                    <ListConfigBooleanControl
                        description={
                            visualizerBlocked ? t('visualizer.exclusiveUnavailable') : undefined
                        }
                        disabled={visualizerBlocked}
                        onChange={(value) => {
                            setSettings({
                                general: {
                                    combinedLyricsAndVisualizer: value,
                                },
                            });
                        }}
                        value={combinedLyricsAndVisualizer}
                    />
                ),
                id: 'combinedLyricsAndVisualizer',
                label: t('setting.combinedLyricsAndVisualizer'),
            },
        ],
        [
            combinedLyricsAndVisualizer,
            setSettings,
            showLyricsInSidebar,
            showQueueInSidebar,
            showVisualizerInSidebar,
            t,
            visualizerBlocked,
        ],
    );

    return (
        <Popover position="top" withArrow>
            <Popover.Target>
                <ActionIcon
                    icon="mediaSettings"
                    iconProps={{
                        size: 'lg',
                    }}
                    size="sm"
                    stopsPropagation
                    tooltip={{
                        label: t('common.setting', { count: 2 }),
                        openDelay: 0,
                    }}
                    variant="subtle"
                />
            </Popover.Target>
            <Popover.Dropdown maw={720} miw={540} onClick={(e) => e.stopPropagation()} p="sm">
                <Stack gap="sm">
                    <Paper p="md" radius="md">
                        <ListConfigTable options={audioOptions} />
                    </Paper>
                    <Paper p="md" radius="md">
                        <ListConfigTable options={transitionOptions} />
                    </Paper>
                    <Paper p="md" radius="md">
                        <ListConfigTable options={playbackOptions} />
                    </Paper>
                    <Paper p="md" radius="md">
                        <ListConfigTable options={sidebarOptions} />
                    </Paper>
                </Stack>
            </Popover.Dropdown>
        </Popover>
    );
};

const AudioPlayerTypeConfig = () => {
    const { t } = useTranslation();
    const status = usePlayerStatus();
    const playbackSettings = usePlaybackSettings();
    const { setSettings } = useSettingsStoreActions();
    const { mediaStop } = usePlayer();

    const showRefreshButton = playbackSettings.type === PlayerType.LOCAL;

    const isCasting = playbackSettings.type === PlayerType.DLNA;

    return (
        <Group gap="xs" wrap="nowrap">
            <Select
                comboboxProps={{ withinPortal: false }}
                data={[
                    {
                        disabled: !isElectron(),
                        label: 'MPV',
                        value: PlayerType.LOCAL,
                    },
                    { label: 'Web', value: PlayerType.WEB },
                    { label: 'Jukebox', value: PlayerType.JUKEBOX },
                    ...(isCasting
                        ? [{ disabled: true, label: 'DLNA', value: PlayerType.DLNA }]
                        : []),
                ]}
                defaultValue={playbackSettings.type}
                disabled={status === PlayerStatus.PLAYING || isCasting}
                onChange={(e) => {
                    setSettings({
                        playback: { ...playbackSettings, type: e as PlayerType },
                    });
                    ipc?.send('settings-set', {
                        property: 'playbackType',
                        value: e,
                    });
                }}
                variant="filled"
                width="100%"
            />
            {showRefreshButton && (
                <ActionIcon
                    icon="refresh"
                    iconProps={{ size: 'md' }}
                    onClick={() => {
                        mediaStop();
                        eventEmitter.emit('MPV_RELOAD', {});
                    }}
                    tooltip={{ label: t('common.reload') }}
                    variant="transparent"
                />
            )}
        </Group>
    );
};

const AudioDeviceConfig = () => {
    const status = usePlayerStatus();
    const playbackType = usePlaybackType();
    const playbackSettings = usePlaybackSettings();

    const audioDevices = useAudioDevices(playbackType);
    const audioDeviceId =
        playbackType === PlayerType.JUKEBOX
            ? PlayerType.JUKEBOX
            : playbackSettings.nativeAudioDeviceId;

    return (
        <Select
            comboboxProps={{ withinPortal: false }}
            data={audioDevices}
            disabled={status === PlayerStatus.PLAYING}
            key={playbackType}
            onChange={selectAudioDestination}
            value={audioDeviceId ?? getDefaultAudioDevice(audioDevices)}
            variant="filled"
            width="100%"
        />
    );
};
