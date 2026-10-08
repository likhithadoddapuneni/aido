import { defineAppConfig } from '@aidooi/ui-web/vite';

// Where the API lives for `dev` and `preview` (the browser only ever talks to this origin). The end-to-end run
// points it at the API it starts.
const api = process.env['OPS_API_URL'] ?? 'http://localhost:3000';
const proxy = { '/v1': api, '/health': api };

export default defineAppConfig({
  server: { port: 5174, proxy },
  preview: { port: 4175, proxy },
});
