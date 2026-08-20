import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Vitest resolves workspace packages through their `package.json` `main`, which
 * points at `dist/`. That means a test could pass against a stale build and
 * report green while the source it is supposed to be testing says something
 * different — which is exactly what happened once here: a model id was changed
 * in source and the suite kept asserting the old value from `dist/`.
 *
 * Aliasing the workspace packages to their TypeScript source removes that whole
 * failure mode. Tests now always exercise the code in the tree, with no
 * dependency on whether `pnpm ready` has been run first.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@extension/runanywhere': resolve(__dirname, '../packages/runanywhere/index.ts'),
      '@extension/storage': resolve(__dirname, '../packages/storage/index.ts'),
      '@src': resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
