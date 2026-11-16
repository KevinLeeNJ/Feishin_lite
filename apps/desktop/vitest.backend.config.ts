import { defineConfig } from 'vitest/config';

import config from './vitest.config';

export default defineConfig({
    ...config,
    test: {
        ...config.test,
        fileParallelism: false,
        include: ['src/main/features/core/backend/*.integration.ts'],
    },
});
