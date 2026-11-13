import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    // Review exports/backups under output/ must never become test projects.
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
  },
});
