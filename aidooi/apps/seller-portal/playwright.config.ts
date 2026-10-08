import { defineConfig } from '@playwright/test';

const API = process.env['E2E_API_PORT'] ?? '3190';
const WEB = process.env['E2E_WEB_PORT'] ?? '5184';

/**
 * Real browser, real SPA (Vite dev server, same-origin proxy as in production), real API on a scratch
 * database. Needs Postgres (`docker compose up postgres`) and a browser:
 * `pnpm --filter @aidooi/ui-web e2e:install` once per machine.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${WEB}`, trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node e2e/server.ts',
      url: `http://127.0.0.1:${API}/health/ready`,
      timeout: 120_000,
      reuseExistingServer: false,
      // Playwright's default is SIGKILL, which would strand the scratch database; let the server drop it.
      gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
      env: { E2E_API_PORT: API },
    },
    {
      command: `pnpm exec vite --host 127.0.0.1 --port ${WEB} --strictPort`,
      url: `http://127.0.0.1:${WEB}`,
      reuseExistingServer: false,
      env: { API_ORIGIN: `http://127.0.0.1:${API}` },
    },
  ],
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
