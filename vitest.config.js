import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // passWithNoTests so the very first run of this plan is green rather than
    // exit 1, which an executing agent would read as a failure.
    passWithNoTests: true,
    // Integration tests boot a real Strapi against one SQLite file; they cannot
    // run concurrently.
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
