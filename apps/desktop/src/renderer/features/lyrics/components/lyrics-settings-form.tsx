import isElectron from 'is-electron';
import { useTranslation } from 'react-i18next';

import { languages } from '/@/i18n/i18n';
import {
    ListConfigBooleanControl,
    ListConfigTable,
} from '/@/renderer/features/shared/components/list-config-menu';
import {
    useLyricsDisplaySettings,
    useLyricsSettings,
    useSettingsStore,
    useSettingsStoreActions,
} from '/@/renderer/store';
import { Fieldset } from '/@/shared/components/fieldset/fieldset';
import { MultiSelect } from '/@/shared/components/multi-select/multi-select';
import { NumberInput } from '/@/shared/components/number-input/number-input';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { Select } from '/@/shared/components/select/select';
import { Slider } from '/@/shared/components/slider/slider';
import { Stack } from '/@/shared/components/stack/stack';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { LyricSource } from '/@/shared/types/domain-types';

const localSettings = isElectron() ? window.api.localSettings : null;

interface LyricsSettingsFormProps {
    settingsKey: string;
}

export const LyricsSettingsForm = ({ settingsKey }: LyricsSettingsFormProps) => {
    const { t } = useTranslation();
    const lyricsSettings = useLyricsSettings();
    const displaySettings = useLyricsDisplaySettings(settingsKey);
    const allLyricsDisplay = useSettingsStore((state) => state.lyricsDisplay);
    const { setSettings } = useSettingsStoreActions();

    const updateLyricsSetting = (updates: Partial<typeof lyricsSettings>) => {
        setSettings({
            lyrics: {
                ...lyricsSettings,
                ...updates,
            },
        });
    };

    const updateDisplaySetting = (updates: Partial<typeof displaySettings>) => {
        setSettings({
            lyricsDisplay: {
                ...allLyricsDisplay,
                [settingsKey]: {
                    ...displaySettings,
                    ...updates,
                },
            },
        });
    };

    const displayOptions = [
        {
            component: (
                <Slider
                    defaultValue={displaySettings.fontSize}
                    label={(value) => `${value}px`}
                    marks={[
                        { label: '8', value: 8 },
                        { label: '24', value: 24 },
                        { label: '48', value: 48 },
                        { label: '72', value: 72 },
                    ]}
                    max={72}
                    min={8}
                    onChangeEnd={(value) => {
                        updateDisplaySetting({ fontSize: value });
                    }}
                    step={1}
                    w="75%"
                />
            ),
            description: t('page.fullscreenPlayer.config.lyricSizeSynchronized', {
                context: 'description',
            }),
            id: 'fontSize',
            label: t(
                `${t('page.fullscreenPlayer.config.lyricSize')} (${t('page.fullscreenPlayer.config.synchronized')})`,
            ),
        },
        {
            component: (
                <Slider
                    defaultValue={displaySettings.fontSizeUnsync}
                    label={(value) => `${value}px`}
                    marks={[
                        { label: '8', value: 8 },
                        { label: '24', value: 24 },
                        { label: '48', value: 48 },
                        { label: '72', value: 72 },
                    ]}
                    max={72}
                    min={8}
                    onChangeEnd={(value) => {
                        updateDisplaySetting({ fontSizeUnsync: value });
                    }}
                    step={1}
                    w="75%"
                />
            ),
            description: t('page.fullscreenPlayer.config.lyricSizeUnsynchronized', {
                context: 'description',
            }),
            id: 'fontSizeUnsync',
            label: t(
                `${t('page.fullscreenPlayer.config.lyricSize')} (${t('page.fullscreenPlayer.config.unsynchronized')})`,
            ),
        },
        {
            component: (
                <Slider
                    defaultValue={displaySettings.gapUnsync}
                    label={(value) => `${value}px`}
                    marks={[
                        { label: '0', value: 0 },
                        { label: '25', value: 25 },
                        { label: '50', value: 50 },
                    ]}
                    max={50}
                    min={0}
                    onChangeEnd={(value) => {
                        updateDisplaySetting({ gapUnsync: value });
                    }}
                    step={1}
                    w="75%"
                />
            ),
            description: t('page.fullscreenPlayer.config.lyricGapUnsynchronized', {
                context: 'description',
            }),
            id: 'gapUnsync',
            label: t(
                `${t('page.fullscreenPlayer.config.lyricGap')} (${t('page.fullscreenPlayer.config.unsynchronized')})`,
            ),
        },
        {
            component: (
                <Slider
                    defaultValue={displaySettings.paddingLeft ?? 0}
                    label={(value) => `${value}%`}
                    marks={[
                        { label: '0', value: 0 },
                        { label: '25', value: 25 },
                        { label: '50', value: 50 },
                    ]}
                    max={50}
                    min={0}
                    onChangeEnd={(value) => {
                        updateDisplaySetting({ paddingLeft: value });
                    }}
                    step={1}
                    w="100%"
                />
            ),
            description: t('page.fullscreenPlayer.config.lyricPaddingLeft', {
                context: 'description',
            }),
            id: 'paddingLeft',
            label: t('page.fullscreenPlayer.config.lyricPaddingLeft'),
        },
        {
            component: (
                <Slider
                    defaultValue={displaySettings.paddingRight ?? 0}
                    label={(value) => `${value}%`}
                    marks={[
                        { label: '0', value: 0 },
                        { label: '25', value: 25 },
                        { label: '50', value: 50 },
                    ]}
                    max={50}
                    min={0}
                    onChangeEnd={(value) => {
                        updateDisplaySetting({ paddingRight: value });
                    }}
                    step={1}
                    w="100%"
                />
            ),
            description: t('page.fullscreenPlayer.config.lyricPaddingRight', {
                context: 'description',
            }),
            id: 'paddingRight',
            label: t('page.fullscreenPlayer.config.lyricPaddingRight'),
        },
        {
            component: (
                <SegmentedControl
                    data={[
                        { label: t('common.left'), value: 'left' },
                        {
                            label: t('common.center'),
                            value: 'center',
                        },
                        { label: t('common.right'), value: 'right' },
                    ]}
                    onChange={(value) =>
                        updateLyricsSetting({ alignment: value as 'center' | 'left' | 'right' })
                    }
                    value={lyricsSettings.alignment}
                    w="100%"
                />
            ),
            description: t('page.fullscreenPlayer.config.lyricAlignment', {
                context: 'description',
            }),
            id: 'alignment',
            label: t('page.fullscreenPlayer.config.lyricAlignment'),
        },
        {
            component: (
                <Slider
                    defaultValue={lyricsSettings.followScrollAlignment ?? 0}
                    label={(value) => value.toString()}
                    marks={[
                        { label: '-50', value: -50 },
                        { label: '-25', value: -25 },
                        { label: '0', value: 0 },
                        { label: '25', value: 25 },
                        { label: '50', value: 50 },
                    ]}
                    max={50}
                    min={-50}
                    onChangeEnd={(value) => {
                        updateLyricsSetting({ followScrollAlignment: value });
                    }}
                    step={1}
                    w="100%"
                />
            ),
            description: t('page.fullscreenPlayer.config.lyricFollowScrollAlignment', {
                context: 'description',
            }),
            id: 'followScrollAlignment',
            label: t('page.fullscreenPlayer.config.lyricFollowScrollAlignment'),
        },
        {
            component: (
                <NumberInput
                    defaultValue={lyricsSettings.lineLeadTimeMs}
                    max={3000}
                    min={0}
                    onBlur={(e) => {
                        const value = Number(e.currentTarget.value);
                        updateLyricsSetting({ lineLeadTimeMs: value });
                    }}
                    step={50}
                    width={100}
                />
            ),
            description: t('page.fullscreenPlayer.config.lyricLineLeadTime', {
                context: 'description',
            }),
            id: 'lineLeadTimeMs',
            label: t('page.fullscreenPlayer.config.lyricLineLeadTime'),
        },
        {
            component: (
                <ListConfigBooleanControl
                    onChange={(value) => updateLyricsSetting({ showMatch: value })}
                    value={lyricsSettings.showMatch}
                />
            ),
            description: t('page.fullscreenPlayer.config.showLyricMatch', {
                context: 'description',
            }),
            id: 'showMatch',
            label: t('page.fullscreenPlayer.config.showLyricMatch'),
        },
        {
            component: (
                <ListConfigBooleanControl
                    onChange={(value) => updateLyricsSetting({ showProvider: value })}
                    value={lyricsSettings.showProvider}
                />
            ),
            description: t('page.fullscreenPlayer.config.showLyricProvider', {
                context: 'description',
            }),
            id: 'showProvider',
            label: t('page.fullscreenPlayer.config.showLyricProvider'),
        },
    ];

    const lyricOptions = [
        {
            component: (
                <NumberInput
                    defaultValue={lyricsSettings.delayMs}
                    onBlur={(e) => {
                        const value = Number(e.currentTarget.value);
                        updateLyricsSetting({ delayMs: value });
                    }}
                    step={10}
                    width={100}
                />
            ),
            description: t('setting.lyricOffset', {
                context: 'description',
            }),
            id: 'delayMs',
            isHidden: !isElectron(),
            label: t('setting.lyricOffset'),
        },
        {
            component: (
                <ListConfigBooleanControl
                    onChange={(value) => updateLyricsSetting({ preferLocalLyrics: value })}
                    value={lyricsSettings.preferLocalLyrics}
                />
            ),
            description: t('setting.preferLocalLyrics', {
                context: 'description',
            }),
            id: 'preferLocalLyrics',
            isHidden: !isElectron(),
            label: t('setting.preferLocalLyrics'),
        },
        {
            component: (
                <ListConfigBooleanControl
                    onChange={(value) => updateLyricsSetting({ fetch: value })}
                    value={lyricsSettings.fetch}
                />
            ),
            description: t('setting.lyricFetch', {
                context: 'description',
            }),
            id: 'fetch',
            isHidden: !isElectron(),
            label: t('setting.lyricFetch'),
        },
        {
            component: (
                <MultiSelect
                    aria-label="Lyric providers"
                    clearable
                    data={Object.values(LyricSource)}
                    defaultValue={lyricsSettings.sources}
                    onChange={(e: string[]) => {
                        localSettings?.set('lyrics', e);
                        updateLyricsSetting({ sources: e.map((source) => source as LyricSource) });
                    }}
                    width="100%"
                />
            ),
            description: t('setting.lyricFetchProvider', {
                context: 'description',
            }),
            id: 'sources',
            isHidden: !isElectron(),
            label: t('setting.lyricFetchProvider'),
        },
        {
            component: (
                <ListConfigBooleanControl
                    onChange={(value) => updateLyricsSetting({ enableFurigana: value })}
                    value={lyricsSettings.enableFurigana ?? false}
                />
            ),
            description: t('setting.enableFurigana', {
                context: 'description',
            }),
            id: 'enableFurigana',
            label: t('setting.enableFurigana'),
        },
        {
            component: (
                <ListConfigBooleanControl
                    onChange={(value) => updateLyricsSetting({ enableRomaji: value })}
                    value={lyricsSettings.enableRomaji ?? false}
                />
            ),
            description: t('setting.enableRomaji', {
                context: 'description',
            }),
            id: 'enableRomaji',
            label: t('setting.enableRomaji'),
        },
        {
            component: (
                <ListConfigBooleanControl
                    onChange={(value) => {
                        updateLyricsSetting({ fetchTranslation: value });
                        localSettings?.set('fetchTranslation', value);
                    }}
                    value={lyricsSettings.fetchTranslation}
                />
            ),
            description: t('setting.fetchTranslation', {
                context: 'description',
            }),
            id: 'fetchTranslation',
            isHidden: !isElectron(),
            label: t('setting.fetchTranslation'),
        },
    ];

    const translationSettings = [
        {
            component: (
                <ListConfigBooleanControl
                    onChange={(value) => updateLyricsSetting({ enableAutoTranslation: value })}
                    value={lyricsSettings.enableAutoTranslation}
                />
            ),
            description: t('setting.enableAutoTranslation', {
                context: 'description',
            }),
            id: 'enableAutoTranslation',
            isHidden: !isElectron(),
            label: t('setting.enableAutoTranslation'),
        },
        {
            component: (
                <Select
                    data={languages}
                    onChange={(value) => {
                        updateLyricsSetting({ translationTargetLanguage: value });
                    }}
                    value={lyricsSettings.translationTargetLanguage}
                    width="100%"
                />
            ),
            description: t('setting.translationTargetLanguage', {
                context: 'description',
            }),
            id: 'translationTargetLanguage',
            isHidden: !isElectron(),
            label: t('setting.translationTargetLanguage'),
        },
        {
            component: (
                <Select
                    clearable
                    data={['Microsoft Azure', 'Google Cloud']}
                    onChange={(value) => {
                        updateLyricsSetting({ translationApiProvider: value });
                    }}
                    value={lyricsSettings.translationApiProvider}
                    width="100%"
                />
            ),
            description: t('setting.translationApiProvider', {
                context: 'description',
            }),
            id: 'translationApiProvider',
            isHidden: !isElectron(),
            label: t('setting.translationApiProvider'),
        },
        {
            component: (
                <TextInput
                    onChange={(e) => {
                        updateLyricsSetting({ translationApiKey: e.currentTarget.value });
                    }}
                    value={lyricsSettings.translationApiKey}
                    width="100%"
                />
            ),
            description: t('setting.translationApiKey', {
                context: 'description',
            }),
            id: 'translationApiKey',
            isHidden: !isElectron(),
            label: t('setting.translationApiKey'),
        },
    ];

    return (
        <Stack gap="sm">
            <Fieldset legend={t('page.setting.lyrics')}>
                <ListConfigTable options={lyricOptions} />
            </Fieldset>
            <Fieldset legend={t('page.setting.lyricsDisplay')}>
                <ListConfigTable options={displayOptions} />
            </Fieldset>
            <Fieldset legend={t('page.setting.lyricsTranslation')}>
                <ListConfigTable options={translationSettings} />
            </Fieldset>
        </Stack>
    );
};
