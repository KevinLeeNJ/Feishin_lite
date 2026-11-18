import { useTranslation } from 'react-i18next';

import {
    SettingOption,
    SettingsSection,
} from '/@/renderer/features/settings/components/settings-section';
import {
    SettingsState,
    useMpvSettings,
    useSettingsStoreActions,
} from '/@/renderer/store/settings.store';
import { NumberInput } from '/@/shared/components/number-input/number-input';
import { Select } from '/@/shared/components/select/select';
import { Switch } from '/@/shared/components/switch/switch';

export function ReplayGainSettings() {
    const { t } = useTranslation();
    const settings = useMpvSettings();
    const { setSettings } = useSettingsStoreActions();
    const update = (properties: Partial<SettingsState['playback']['mpvProperties']>) => {
        setSettings({ playback: { mpvProperties: properties } });
    };

    const replayGainOptions: SettingOption[] = [
        {
            control: (
                <Select
                    data={[
                        {
                            label: t('setting.replayGainMode', {
                                context: 'optionNone',
                            }),
                            value: 'no',
                        },
                        {
                            label: t('setting.replayGainMode', {
                                context: 'optionTrack',
                            }),
                            value: 'track',
                        },
                        {
                            label: t('setting.replayGainMode', {
                                context: 'optionAlbum',
                            }),
                            value: 'album',
                        },
                    ]}
                    defaultValue={settings.replayGainMode}
                    onChange={(e) =>
                        e && update({ replayGainMode: e as typeof settings.replayGainMode })
                    }
                />
            ),
            description: t('setting.replayGainMode', {
                context: 'description',
                ReplayGain: 'ReplayGain',
            }),
            title: t('setting.replayGainMode', { ReplayGain: 'ReplayGain' }),
        },
        {
            control: (
                <NumberInput
                    defaultValue={settings.replayGainPreampDB}
                    onChange={(e) => update({ replayGainPreampDB: Number(e) || 0 })}
                    width={75}
                />
            ),
            description: t('setting.replayGainMode', {
                context: 'description',
                ReplayGain: 'ReplayGain',
            }),
            title: t('setting.replayGainPreamp', { ReplayGain: 'ReplayGain' }),
        },
        {
            control: (
                <Switch
                    defaultChecked={settings.replayGainClip}
                    onChange={(e) => update({ replayGainClip: e.currentTarget.checked })}
                />
            ),
            description: t('setting.replayGainClipping', {
                context: 'description',
                ReplayGain: 'ReplayGain',
            }),
            title: t('setting.replayGainClipping', { ReplayGain: 'ReplayGain' }),
        },
        {
            control: (
                <NumberInput
                    defaultValue={settings.replayGainFallbackDB}
                    onBlur={(e) =>
                        update({
                            replayGainFallbackDB:
                                e.currentTarget.value === ''
                                    ? undefined
                                    : Number(e.currentTarget.value),
                        })
                    }
                    width={75}
                />
            ),
            description: t('setting.replayGainFallback', { ReplayGain: 'ReplayGain' }),
            title: t('setting.replayGainFallback', { ReplayGain: 'ReplayGain' }),
        },
    ];

    return <SettingsSection options={replayGainOptions} />;
}
