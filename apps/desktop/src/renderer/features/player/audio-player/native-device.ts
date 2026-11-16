import { useSettingsStore } from '/@/renderer/store/settings.store';
import { PlayerType } from '/@/shared/types/types';

export async function initializeNativeDevice(): Promise<void> {
    const settings = useSettingsStore.getState().playback;
    if (settings.nativeAudioDeviceId !== undefined) {
        return;
    }
    const selected =
        settings.type === PlayerType.LOCAL ? settings.mpvAudioDeviceId : settings.audioDeviceId;
    let target = 'default';
    if (selected && selected !== 'default' && selected !== 'auto') {
        const { devices } = await window.api.hostBridge.backend.listOutputDevices();
        const browser = await navigator.mediaDevices.enumerateDevices();
        const label = browser.find((device) => device.deviceId === selected)?.label;
        const matched = matchNativeDevice(selected, devices, label);
        if (!matched) {
            throw new Error(
                'The saved audio device is unavailable. Select an output device in audio settings.',
            );
        }
        target = matched;
    }
    if (useSettingsStore.getState().playback.nativeAudioDeviceId === undefined) {
        useSettingsStore
            .getState()
            .actions.setSettings({ playback: { nativeAudioDeviceId: target } });
    }
}

export function matchNativeDevice(
    selected: string,
    devices: { id: string; name: string }[],
    label?: string,
): string | undefined {
    const identifier = selected
        .match(/\{[0-9a-f-]+\}/gi)
        ?.at(-1)
        ?.toLowerCase();
    return devices.find(
        (device) =>
            device.id === selected ||
            (identifier && device.id.toLowerCase().includes(identifier)) ||
            (label && device.name === label),
    )?.id;
}
