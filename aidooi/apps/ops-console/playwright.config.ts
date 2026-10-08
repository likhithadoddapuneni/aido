import { defineConfig } from '@playwright/test';

const API_PORT = 3100;
const STATE_PORT = 3101;
const WEB_PORT = 4175;

/**
 * Real end-to-end: the built console in a real browser, talking to the real API (started from source) over a
 * real, seeded database. Browsers are not installed by `pnpm install`: run `pnpm --filter @aidooi/ui-web e2e:install`.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // One story, in order: later steps act on what earlier ones changed.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}`, trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node e2e/support/stack.ts',
      env: { E2E_API_PORT: String(API_PORT), E2E_STATE_PORT: String(STATE_PORT) },
      url: `http://127.0.0.1:${STATE_PORT}/state`,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `pnpm build && pnpm exec vite preview --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      env: { OPS_API_URL: `http://127.0.0.1:${API_PORT}` },
      url: `http://127.0.0.1:${WEB_PORT}`,
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
