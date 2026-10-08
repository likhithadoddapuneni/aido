import { writeFileSync } from 'node:fs';
import { NO_DEPOSIT_CREDIT } from '../modules/commerce/no-deposit-credit.ts';
import path from 'node:path';
import type { Kysely } from 'kysely';
import type { DB } from '@aidooi/db';
import { unconfiguredMedia } from '../adapters/unconfigured-media.ts';
import { buildApp } from '../app.ts';
import { systemClock } from '../clock.ts';
import { loadConfig } from '../config.ts';
import { uuidV7Generator } from '../ids.ts';
import { anonymousAuthenticator } from '../modules/auth/authenticator.ts';
import { MockGateway } from '../payments/mock-gateway.ts';

const out = path.resolve(import.meta.dirname, '../../../../packages/contracts/openapi.json');
const never = new Proxy(
  {},
  {
    get: () => () => Promise.reject(new Error('The OpenAPI generator does not touch the database')),
  },
);
const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', RELEASE: 'contract' });
const app = await buildApp({
  ctx: {
    config,
    clock: systemClock,
    db: never as unknown as Kysely<DB>,
    ids: uuidV7Generator,
    gateway: new MockGateway({ clock: systemClock }),
    notifier: { send: async () => undefined },
    otp: { send: async () => undefined },
    depositCredit: NO_DEPOSIT_CREDIT,
    media: unconfiguredMedia,
    authenticator: anonymousAuthenticator,
  },
});
await app.ready();
writeFileSync(out, JSON.stringify(app.swagger(), null, 2) + '\n');
await app.close();
console.log(`wrote ${out}`);
