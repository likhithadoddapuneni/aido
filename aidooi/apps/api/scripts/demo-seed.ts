/**
 * Prepare a demo machine: migrate, load the seed catalogue (with the compatibility maps approved), and
 * create one staff login per role with a real authenticator secret. Writes `.demo/credentials.json`.
 * Development only: it uses fixed passwords and prints secrets.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { sql } from 'kysely';
import { migrate } from '@aidooi/db';
import { seedDatabase } from '@aidooi/db/testing';
import { createDb, createPool } from '@aidooi/db';
import { loadConfig } from '../src/config.ts';
import { runAsSystem } from '../src/context.ts';
import {
  acceptInvite,
  enrollMfa,
  inviteOpsUser,
  inviteSellerUser,
  confirmMfa,
} from '../src/modules/auth/staff.ts';
import { base32Decode, hotp, stepAt } from '../src/modules/auth/totp.ts';
import { createContext } from '../src/wiring.ts';

const PASSWORD = 'Demo-password-2026!';
const admin = process.env['DATABASE_ADMIN_URL'];
if (!admin) throw new Error('DATABASE_ADMIN_URL is required');
if (process.env['NODE_ENV'] === 'production')
  throw new Error('The demo seed must never run in production');

await migrate(admin);
const pool = createPool(admin, { max: 2 });
const db = createDb(pool);
const existing = await sql<{
  n: string;
}>`SELECT count(*)::text AS n FROM catalogue.partner`.execute(db);
const seeded = Number(existing.rows[0]?.n) > 0 ? null : await seedDatabase(db);
const partners = await db
  .selectFrom('catalogue.partner')
  .select(['id', 'code', 'trade_name'])
  .orderBy('code')
  .execute();
const marker = await db
  .selectFrom('identity.ops_user')
  .select('email')
  .where('email', '=', 'admin@demo.aidooi.test')
  .executeTakeFirst();
await pool.end();

const config = loadConfig(process.env);
const log = pino({ level: 'silent' });
const { ctx, close } = createContext(config, log);
const deps = { clock: ctx.clock, ids: ctx.ids };

interface Cred {
  role: string;
  email: string;
  password: string;
  totpSeed: string;
  app: string;
  partner?: string;
}
const creds: Cred[] = [];

async function onboard(
  role: string,
  app: string,
  invite: () => Promise<{ inviteToken: string }>,
  email: string,
  partner?: string,
) {
  const inv = await invite();
  await acceptInvite(ctx, { token: inv.inviteToken, password: PASSWORD });
  const enrol = await enrollMfa(ctx, { email, password: PASSWORD });
  const seed = enrol.seed;
  const code = hotp(base32Decode(seed), stepAt(ctx.clock.now()));
  await confirmMfa(ctx, { email, password: PASSWORD, totpCode: code });
  creds.push({
    role,
    email,
    password: PASSWORD,
    totpSeed: seed,
    app,
    ...(partner ? { partner } : {}),
  });
}

if (!marker && partners[0]) {
  const p = partners[0];
  const ops = (
    role: 'ops_admin' | 'ops_catalogue' | 'ops_support' | 'ops_finance',
    email: string,
  ) =>
    onboard(
      role,
      'ops-console',
      () =>
        runAsSystem(ctx, (trx) =>
          inviteOpsUser(trx, deps, { email, fullName: `Demo ${role}`, role }),
        ),
      email,
    );
  await ops('ops_admin', 'admin@demo.aidooi.test');
  await ops('ops_catalogue', 'catalogue@demo.aidooi.test');
  await ops('ops_support', 'support@demo.aidooi.test');
  await ops('ops_finance', 'finance1@demo.aidooi.test');
  await ops('ops_finance', 'finance2@demo.aidooi.test');
  for (const [role, email] of [
    ['seller_owner', 'owner@demo.aidooi.test'],
    ['seller_staff', 'staff@demo.aidooi.test'],
  ] as const) {
    await onboard(
      role,
      'seller-portal / seller-app',
      () =>
        runAsSystem(ctx, (trx) =>
          inviteSellerUser(trx, deps, { partnerId: p.id, email, fullName: `Demo ${role}`, role }),
        ),
      email,
      `${p.code} ${p.trade_name}`,
    );
  }
  const dir = path.resolve(import.meta.dirname, '../../../.demo');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'credentials.json'), JSON.stringify(creds, null, 2) + '\n', {
    mode: 0o600,
  });
}
await close();
console.log(
  seeded ? `seeded ${partners.length} partners and the catalogue` : 'catalogue already present',
);
console.log(
  creds.length
    ? `created ${creds.length} staff logins → .demo/credentials.json`
    : 'staff logins already exist (see .demo/credentials.json)',
);
