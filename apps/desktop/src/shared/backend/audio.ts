import { z } from 'zod';

export const audioTransitionSchema = z
    .object({
        crossfadeDuration: z.number().min(0).max(21),
        crossfadeStyle: z.enum(['equalPower', 'exponential', 'linear', 'sCurve']),
        mode: z.enum(['gapless', 'crossfade', 'none']),
    })
    .strict();

export const audioSettingsSchema = z
    .object({
        compressor: z
            .object({
                attack: z.number().min(0).max(1000),
                enabled: z.boolean(),
                knee: z.number().min(0).max(40),
                makeup: z.number().min(0).max(40),
                ratio: z.number().min(1).max(20),
                release: z.number().min(0).max(5000),
                threshold: z.number().min(-100).max(0),
            })
            .strict(),
        deviceId: z.string().max(2048).nullable(),
        equalizer: z
            .object({
                bands: z
                    .array(
                        z
                            .object({
                                freq: z.number().min(10).max(24000),
                                gain: z.number().min(-24).max(24),
                            })
                            .strict(),
                    )
                    .max(32),
                enabled: z.boolean(),
                preamp: z.number().min(-24).max(24),
            })
            .strict(),
        exclusive: z.boolean().optional(),
        fadeOnPause: z.boolean(),
        muted: z.boolean(),
        preservePitch: z.boolean(),
        replayGain: z
            .object({
                clip: z.boolean(),
                fallbackDb: z.number().finite().optional(),
                mode: z.enum(['album', 'no', 'track']),
                preampDb: z.number().finite(),
            })
            .strict()
            .optional(),
        sampleRate: z.number().int().min(8000).max(384000).optional(),
        speed: z.number().min(0.5).max(2),
        transition: audioTransitionSchema.optional(),
        volume: z.number().min(0).max(100),
    })
    .strict();

export const audioTrackSchema = z
    .object({
        duration: z
            .number()
            .min(0)
            .max(7 * 86400),
        gainDb: z.number().min(-60).max(30),
        instanceId: z.string().min(1).max(128),
        queueRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        replayGain: z
            .object({
                albumGain: z.number().finite().optional(),
                albumPeak: z.number().positive().finite().optional(),
                trackGain: z.number().finite().optional(),
                trackPeak: z.number().positive().finite().optional(),
            })
            .strict()
            .optional(),
        url: z
            .string()
            .url()
            .max(16384)
            .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol)),
    })
    .strict();

export const audioCommandSchema = z.discriminatedUnion('method', [
    z
        .object({
            method: z.literal('load'),
            params: z
                .object({
                    paused: z.boolean(),
                    settings: audioSettingsSchema,
                    start: z.number().min(0),
                    track: audioTrackSchema,
                })
                .strict(),
        })
        .strict(),
    z.object({ method: z.literal('configure'), params: audioSettingsSchema }).strict(),
    z
        .object({
            method: z.literal('seek'),
            params: z.object({ position: z.number().min(0) }).strict(),
        })
        .strict(),
    z
        .object({
            method: z.literal('setPaused'),
            params: z.object({ paused: z.boolean() }).strict(),
        })
        .strict(),
    z.object({ method: z.literal('stop') }).strict(),
    z.object({ method: z.literal('snapshot') }).strict(),
    z.object({ method: z.literal('visualizerSamples') }).strict(),
    z
        .object({
            method: z.literal('prepareNext'),
            params: z.object({ track: audioTrackSchema.nullable() }).strict(),
        })
        .strict(),
]);

export const audioSnapshotSchema = z
    .object({
        buffering: z.boolean(),
        duration: z.number().nonnegative(),
        ended: z.boolean(),
        error: z.string().nullable(),
        instanceId: z.string().nullable(),
        outputLatencyMs: z.number().nonnegative(),
        paused: z.boolean(),
        position: z.number().nonnegative(),
        queueRevision: z.number().int().nonnegative(),
        sampleRate: z.number().int().nonnegative(),
        transitionRateMismatch: z.boolean().optional(),
        underruns: z.number().int().nonnegative(),
    })
    .strict();

export const visualizerSamplesSchema = z
    .object({
        generation: z.number().int().nonnegative(),
        pcm: z.string().min(8).max(204800).base64(),
        sampleRate: z.number().int().min(8000).max(384000),
    })
    .strict();

export type AudioCommand = z.infer<typeof audioCommandSchema>;
export type AudioSettings = z.infer<typeof audioSettingsSchema>;
export type AudioSnapshot = z.infer<typeof audioSnapshotSchema>;
export type AudioTrack = z.infer<typeof audioTrackSchema>;
export type AudioTransition = z.infer<typeof audioTransitionSchema>;
export type VisualizerSamples = z.infer<typeof visualizerSamplesSchema>;
