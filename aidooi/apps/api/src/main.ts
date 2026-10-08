import pino from 'pino';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createContext } from './wiring.ts';

const config = loadConfig();
const log = pino({ level: config.LOG_LEVEL });
const { ctx, close } = createContext(config, log);

const app = await buildApp({
  ctx,
  checks: [
    {
      name: 'database',
      run: async () => void (await ctx.db.selectNoFrom((e) => e.val(1).as('ok')).execute()),
    },
  ],
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: config.HOST });
