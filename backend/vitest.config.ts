import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Tests that touch env validation need a deterministic environment.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-to-pass-validation',
      JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-to-pass-validation',
    },
  },
});
