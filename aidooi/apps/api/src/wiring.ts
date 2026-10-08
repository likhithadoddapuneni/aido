import type { FastifyBaseLogger } from 'fastify';
import { createDepositCreditPort } from './modules/viewing/credit-port.ts';
import { createDb, createPool } from '@aidooi/db';
import { unconfiguredMedia } from './adapters/unconfigured-media.ts';
import { LogNotifier, LogOtpSender } from './adapters/log-notifier.ts';
import { systemClock } from './clock.ts';
import type { Config } from './config.ts';
import type { AppContext } from './context.ts';
import { uuidV7Generator } from './ids.ts';
import { JwtAuthenticator } from './modules/auth/authenticator.ts';
import { MockGateway } from './payments/mock-gateway.ts';

/** Build the production dependency graph from configuration. The single place adapters are chosen. */
export function createContext(
  config: Config,
  log: FastifyBaseLogger,
): { ctx: AppContext; close: () => Promise<void> } {
  if (!config.DATABASE_URL) throw new Error('DATABASE_URL is required to start the API');
  const pool = createPool(config.DATABASE_URL, {
    max: 20,
    onError: (err) => log.warn({ err }, 'idle database client error; the pool will reconnect'),
  });
  const db = createDb(pool);
  const ctx: AppContext = {
    config,
    clock: systemClock,
    db,
    ids: uuidV7Generator,
    gateway: new MockGateway({ clock: systemClock }, config.PAYMENT_WEBHOOK_SECRET),
    notifier: new LogNotifier(log),
    otp: new LogOtpSender(log, config.DEMO_REVEAL_OTP),
    depositCredit: createDepositCreditPort(() => ctx),
    media: unconfiguredMedia,
    authenticator: new JwtAuthenticator({ db, config, clock: systemClock }),
  };
  return { ctx, close: () => pool.end() };
}
