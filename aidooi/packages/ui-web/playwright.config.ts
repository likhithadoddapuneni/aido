import { defineConfig } from '@playwright/test';

/**
 * End-to-end setup, shared by the web apps (each app extends or copies this with its own `webServer`).
 * Browsers are NOT installed by `pnpm install` (a ~150 MB download): run `pnpm --filter @aidooi/ui-web e2e:install`
 * once per machine, and in CI before the e2e job.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  webServer: {
    command:
      'pnpm run build:playground && pnpm exec vite preview --config playground/vite.config.ts --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env['CI'],
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
