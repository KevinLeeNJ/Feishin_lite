import isElectron from 'is-electron';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import {
    nativeTransitionRateMismatch,
    subscribeNativeTransitionRateMismatch,
} from '/@/renderer/features/player/audio-player/native-playback-clock';
import { useTransitionControlDisabled } from '/@/renderer/features/player/hooks/use-transition-control-disabled';
import {
    usePlaybackSettings,
    usePlaybackType,
    usePlayerActions,
    usePlayerProperties,
} from '/@/renderer/store';
import { isClientPlayback } from '/@/shared/backend/playback-target';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { Select } from '/@/shared/components/select/select';
import { Slider } from '/@/shared/components/slider/slider';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { CrossfadeStyle, PlayerStyle } from '/@/shared/types/types';

export const TransitionTypeConfig = () => {
    const { t } = useTranslation();
    const disabled = useTransitionControlDisabled('type');
    const { transitionType } = usePlayerProperties();
    const { setTransitionType } = usePlayerActions();
    const { mpvProperties } = usePlaybackSettings();
    const playbackType = usePlaybackType();
    const automaticExclusive =
        isElectron() &&
        isClientPlayback(playbackType) &&
        mpvProperties.audioExclusiveMode === 'yes' &&
        !mpvProperties.audioSampleRateHz;
    const rateMismatch = useTransitionRateMismatch();

    return (
        <Stack gap="xs" w="100%">
            <TransitionStyleControl
                disabled={disabled}
                onChange={setTransitionType}
                rateMismatch={rateMismatch}
                transitionType={transitionType}
            />
            {automaticExclusive && (
                <Text c="dimmed" size="xs">
                    {t(
                        rateMismatch
                            ? 'setting.playbackStyleRateMismatch'
                            : 'setting.playbackStyleExclusiveAuto',
                    )}
                </Text>
            )}
        </Stack>
    );
};

const useTransitionRateMismatch = () =>
    useSyncExternalStore(subscribeNativeTransitionRateMismatch, nativeTransitionRateMismatch);

const TransitionStyleControl = ({
    disabled,
    onChange,
    rateMismatch,
    transitionType,
}: {
    disabled: boolean;
    onChange: (style: PlayerStyle) => void;
    rateMismatch: boolean;
    transitionType: PlayerStyle;
}) => {
    const { t } = useTranslation();

    return (
        <SegmentedControl
            data={[
                {
                    disabled: rateMismatch,
                    label: t('setting.playbackStyle', {
                        context: 'optionNormal',
                    }),
                    value: PlayerStyle.GAPLESS,
                },
                {
                    disabled: rateMismatch,
                    label: t('setting.playbackStyle', {
                        context: 'optionCrossFade',
                    }),
                    value: PlayerStyle.CROSSFADE,
                },
                {
                    label: t('setting.playbackStyle', {
                        context: 'optionNone',
                    }),
                    value: PlayerStyle.NONE,
                },
            ]}
            disabled={disabled}
            onChange={(value) => onChange(value as PlayerStyle)}
            size="sm"
            value={transitionType}
            w="100%"
        />
    );
};

export const CrossfadeStyleConfig = () => {
    const transitionDisabled = useTransitionControlDisabled('style');
    const rateMismatch = useTransitionRateMismatch();
    const { crossfadeStyle } = usePlayerProperties();
    const { setCrossfadeStyle } = usePlayerActions();

    return (
        <Select
            comboboxProps={{ withinPortal: false }}
            data={[
                { label: 'Linear', value: CrossfadeStyle.LINEAR },
                { label: 'Equal Power', value: CrossfadeStyle.EQUAL_POWER },
                { label: 'S-Curve', value: CrossfadeStyle.S_CURVE },
                { label: 'Exponential', value: CrossfadeStyle.EXPONENTIAL },
            ]}
            defaultValue={crossfadeStyle}
            disabled={transitionDisabled || rateMismatch}
            onChange={(e) => {
                if (e) {
                    setCrossfadeStyle(e as CrossfadeStyle);
                }
            }}
            variant="filled"
            width="100%"
        />
    );
};

export const CrossfadeDurationConfig = () => {
    const transitionDisabled = useTransitionControlDisabled('duration');
    const rateMismatch = useTransitionRateMismatch();
    const { crossfadeDuration } = usePlayerProperties();
    const { setCrossfadeDuration } = usePlayerActions();

    return (
        <Slider
            defaultValue={crossfadeDuration}
            disabled={transitionDisabled || rateMismatch}
            marks={[
                { label: '3', value: 3 },
                { label: '6', value: 6 },
                { label: '9', value: 9 },
                { label: '12', value: 12 },
                { label: '15', value: 15 },
                { label: '18', value: 18 },
                { label: '21', value: 21 },
            ]}
            max={21}
            min={3}
            onChangeEnd={setCrossfadeDuration}
            w="100%"
        />
    );
};
