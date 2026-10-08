import { createServer } from 'node:http';
import pino from 'pino';
import { loadConfig } from './config.ts';
import { RECURRING, allJobHandlers } from './jobs/registry.ts';
import { startWorker } from './jobs/runner.ts';
import { createContext } from './wiring.ts';

const config = loadConfig();
const log = pino({ level: config.LOG_LEVEL });
const { ctx, close } = createContext(config, log);

const worker = startWorker(ctx, allJobHandlers(), {
  recurring: RECURRING,
  onError: (err) => log.error({ err }, 'worker loop error'),
});
log.info('worker started');

// The worker serves no API, only its own liveness: unhealthy if the poll loop has stalled.
const STALL_MS = 60_000;
const health = createServer((req, res) => {
  const alive = Date.now() - worker.lastTickAt() < STALL_MS;
  res.writeHead(req.url === '/health/live' && alive ? 200 : 503, {
    'content-type': 'application/json',
  });
  res.end(JSON.stringify({ status: alive ? 'ok' : 'stalled' }));
});
health.listen(config.PORT, config.HOST);

const shutdown = async (signal: string) => {
  log.info({ signal }, 'worker stopping');
  health.close();
  await worker.stop();
  await close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
