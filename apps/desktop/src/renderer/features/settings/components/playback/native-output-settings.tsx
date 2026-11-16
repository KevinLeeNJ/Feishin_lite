import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SettingsSection } from '/@/renderer/features/settings/components/settings-section';
import { usePlaybackSettings, useSettingsStoreActions } from '/@/renderer/store/settings.store';
import { NumberInput } from '/@/shared/components/number-input/number-input';
import { Switch } from '/@/shared/components/switch/switch';
import { Text } from '/@/shared/components/text/text';

export function NativeOutputSettings() {
    const { t } = useTranslation();
    return (
        <SettingsSection
            options={[
                {
                    control: <SampleRateControl />,
                    description: t('setting.sampleRate', { context: 'description' }),
                    title: t('setting.sampleRate'),
                },
                {
                    control: <ExclusiveControl />,
                    description: t('setting.audioExclusiveMode', { context: 'description' }),
                    title: t('setting.audioExclusiveMode'),
                },
            ]}
        />
    );
}

function ExclusiveControl() {
    const settings = usePlaybackSettings();
    const { setSettings } = useSettingsStoreActions();
    return (
        <Switch
            checked={settings.mpvProperties.audioExclusiveMode === 'yes'}
            onChange={(event) =>
                setSettings({
                    playback: {
                        mpvProperties: {
                            audioExclusiveMode: event.currentTarget.checked ? 'yes' : 'no',
                        },
                    },
                })
            }
        />
    );
}

function SampleRateControl() {
    const settings = usePlaybackSettings();
    const { setSettings } = useSettingsStoreActions();
    const [rate, setRate] = useState<number | string>(
        settings.mpvProperties.audioSampleRateHz || '',
    );
    const commitRate = () => {
        const value = Number(rate);
        const audioSampleRateHz = value >= 8000 ? Math.min(192000, Math.round(value)) : 0;
        setRate(audioSampleRateHz || '');
        setSettings({ playback: { mpvProperties: { audioSampleRateHz } } });
    };
    return (
        <NumberInput
            allowDecimal={false}
            max={192000}
            min={0}
            onBlur={commitRate}
            onChange={setRate}
            onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
            }}
            placeholder="0"
            rightSection={<Text size="xs">Hz</Text>}
            value={rate}
            width={110}
        />
    );
}
