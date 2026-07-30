import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // The service/lib modules guard themselves with `import 'server-only'`,
      // which throws under plain Node. Next replaces it with an empty module in
      // server builds; we do the same for the test run.
      { find: 'server-only', replacement: path.resolve(root, 'test/stubs/server-only.ts') },
      // Mirror the `@/*` -> `src/*` path alias from tsconfig.json.
      { find: /^@\/(.*)$/, replacement: `${path.resolve(root, 'src')}/$1` },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The env module validates configuration at import time, so tests that pull
    // in a service (transitively importing it) need a deterministic environment.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-to-pass-validation',
      JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-to-pass-validation',
      // A fixed cloud name so the upload URL checks are deterministic: the
      // service reads it from `env` and the test builds its fixtures from the
      // same `process.env` value, so the two agree on the configured account.
      CLOUDINARY_CLOUD_NAME: 'test-cloud',
    },
  },
});
