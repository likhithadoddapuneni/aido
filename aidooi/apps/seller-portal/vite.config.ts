import { defineAppConfig } from '@aidooi/ui-web/vite';

// In development the API runs on :3000; the proxy keeps the SPA same-origin, as in production.
const api = process.env['API_ORIGIN'] ?? 'http://localhost:3000';

export default defineAppConfig({
  server: { port: 5174, proxy: { '/v1': api } },
  preview: { port: 4174 },
});
