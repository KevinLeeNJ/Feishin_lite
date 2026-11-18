import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            '/@/main': `${root}src/main`,
            '/@/renderer': `${root}src/renderer`,
            '/@/shared': `${root}src/shared`,
        },
    },
    test: {
        environment: 'node',
        include: [
            'src/shared/backend/**/*.test.ts',
            'src/main/features/core/backend/**/*.test.ts',
            'src/main/features/core/permissions.test.ts',
            'src/renderer/features/player/audio-player/**/*.test.ts',
            'src/renderer/features/player/audio-player/**/*.test.tsx',
            'src/renderer/features/player/hooks/**/*.test.ts',
            'src/renderer/features/player/components/transition-config.test.tsx',
            'src/renderer/features/visualizer/*.test.ts',
            'src/shared/lyrics/**/*.test.ts',
            'src/main/features/core/lyrics/**/*.test.ts',
            'src/renderer/features/lyrics/api/**/*.test.ts',
            'src/renderer/features/lyrics/hooks/**/*.test.ts',
            'src/renderer/features/lyrics/*.test.tsx',
        ],
    },
});
