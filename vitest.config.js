import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['src/**/*.test.{js,jsx}', 'supabase/tests/**/*.test.js'],
    environment: 'node',
    // The business runs on IST; date tests assert against it.
    env: { TZ: 'Asia/Kolkata' },
    // Each database test file boots its own in-process Postgres; give it room.
    testTimeout: 60000,
    hookTimeout: 120000,
  },
});
