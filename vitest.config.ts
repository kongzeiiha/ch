import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@ch/db': resolve(__dirname, 'packages/db/src/index.ts'),
      '@ch/agents': resolve(__dirname, 'packages/agents/src/index.ts'),
    },
  },
  test: {
    include: ['apps/*/src/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    environment: 'node',
  },
});
