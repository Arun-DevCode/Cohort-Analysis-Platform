import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false, // Run test files serially to prevent Argon2 and PGlite WASM CPU contention
  },
});
