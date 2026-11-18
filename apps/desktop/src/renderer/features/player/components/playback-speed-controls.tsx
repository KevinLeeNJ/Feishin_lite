import { useMemo } from 'react';

import { usePlayerActions, usePlayerSongProperties, usePlayerSpeed } from '/@/renderer/store';
import { useMicrotonalPitchControls } from '/@/renderer/store/settings.store';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Slider } from '/@/shared/components/slider/slider';
import { Text } from '/@/shared/components/text/text';

export const PlaybackSpeedSlider = () => {
    const speed = usePlayerSpeed();
    const { setSpeed } = usePlayerActions();
    const { bpm } = usePlayerSongProperties(['bpm']) ?? {};

    const formatPlaybackSpeedSliderLabel = useMemo(
        () => (value: number) => {
            const bpmValue = Number(bpm);
            if (bpmValue > 0) {
                return `${value.toFixed(2)} x / ${(bpmValue * value).toFixed(1)} BPM`;
            }
            return `${value.toFixed(2)} x`;
        },
        [bpm],
    );

    return (
        <Slider
            label={formatPlaybackSpeedSliderLabel}
            marks={[
                { label: '0.5', value: 0.5 },
                { label: '0.75', value: 0.75 },
                { label: '1', value: 1 },
                { label: '1.25', value: 1.25 },
                { label: '1.5', value: 1.5 },
                { label: '1.75', value: 1.75 },
                { label: '2', value: 2 },
            ]}
            max={2}
            min={0.5}
            onChange={setSpeed}
            onDoubleClick={() => setSpeed(1)}
            step={0.01}
            value={speed}
            w="320px"
        />
    );
};

export const PitchControls = () => {
    const microtonal = useMicrotonalPitchControls();
    const speed = usePlayerSpeed();
    const { setSpeed } = usePlayerActions();

    const speedToPitch = (speed: number) => {
        return 12 * Math.log2(speed);
    };

    const pitchToSpeed = (pitch: number) => {
        return 2 ** (pitch / 12);
    };

    const adjustMusicalSpeed = (adjustment: number) => {
        const curPitch = speedToPitch(speed);
        const newSpeed = pitchToSpeed(curPitch + adjustment);
        setSpeed(newSpeed);
    };

    return (
        <Group gap={microtonal ? 'xs' : 'md'} my="md" w="100%" wrap="nowrap">
            <Button
                aria-label="-1 semitone"
                fullWidth
                fw={400}
                onClick={() => adjustMusicalSpeed(-1)}
                size="compact-xs"
            >
                -1st
            </Button>
            {microtonal && (
                <Button
                    aria-label="-10 cents"
                    fullWidth
                    fw={400}
                    onClick={() => adjustMusicalSpeed(-0.1)}
                    size="compact-xs"
                >
                    -10ct
                </Button>
            )}
            <Text size="sm" style={{ fontFamily: 'monospace' }} ta="center">
                {speed.toFixed(2)}x {speedToPitch(speed) > 0 && '+'}
                {speedToPitch(speed) == 0 && '±'}
                {speedToPitch(speed).toFixed(2)}st
            </Text>
            {microtonal && (
                <Button
                    aria-label="+10 cents"
                    fullWidth
                    fw={400}
                    onClick={() => adjustMusicalSpeed(0.1)}
                    size="compact-xs"
                >
                    +10ct
                </Button>
            )}
            <Button
                aria-label="+1 semitone"
                fullWidth
                fw={400}
                onClick={() => adjustMusicalSpeed(1)}
                size="compact-xs"
            >
                +1st
            </Button>
        </Group>
    );
};
