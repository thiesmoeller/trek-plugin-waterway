import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['server/**/*.js'],
      reporter: ['text', 'json-summary', 'lcov', 'html'],
      thresholds: {
        statements: 84,
        branches: 75,
        functions: 85,
        lines: 85,
      },
    },
  },
});
