/**
 * The system under test for the console's end-to-end run: a real Postgres database (migrated, seeded), the
 * REAL API started from source as its own process, and three staff accounts created the way real staff are
 * (invited, password set, authenticator enrolled and confirmed over HTTP). Nothing here is mocked except what
 * the API itself mocks (the payment gateway).
 *
 * Playwright starts this as a `webServer`. It prints nothing until it is ready, then serves `/state` (the
 * sign-in details and what each flow should find) and `/totp?user=…` (the code the user's authenticator would
 * show right now) on STATE_PORT, so the tests need no access to the database or the API's internals.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../../api/src/config.ts';
import { runAsSystem } from '../../../api/src/context.ts';
import { inviteOpsUser } from '../../../api/src/modules/auth/staff.ts';
import { base32Decode, hotp, stepAt } from '../../../api/src/modules/auth/totp.ts';
import { createContext } from '../../../api/src/wiring.ts';
import { startHarness } from '../../../api/test/support/harness.ts';
import { confirmDirect, createOrder } from '../../../api/test/support/orders.ts';

const API_PORT = Number(process.env['E2E_API_PORT'] ?? 3100);
const STATE_PORT = Number(process.env['E2E_STATE_PORT'] ?? 3101);
const API = `http://127.0.0.1:${API_PORT}`;
const PASSWORD = 'correct horse battery staple';
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const AUTH_SECRET = 'e2e-auth-secret-0123456789abcdef0123456789';
const VIEWING_PASS_SECRET = 'e2e-viewing-secret-0123456789abcdef0123456789';

type Role = 'ops_admin' | 'ops_finance';
interface Account {
  readonly email: string;
  readonly password: string;
  readonly role: Role;
  readonly seed: string;
}

/** The API wiring wants a logger; nothing in this process needs to hear from it. */
const silentLogger = new Proxy({}, { get: () => () => silentLogger }) as never;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const code = (seed: string, stepOffset = 0) =>
  hotp(base32Decode(seed), stepAt(Date.now()) + stepOffset);

async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function waitFor(url: string, ms: number): Promise<void> {
  const until = Date.now() + ms;
  for (;;) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > until) throw new Error(`${url} did not become ready`);
    await sleep(250);
  }
}

const h = await startHarness();
let api: ChildProcess | undefined;
let stopping = false;

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  api?.kill('SIGTERM');
  await h.app.close().catch(() => undefined);
  await h.database.drop().catch(() => undefined);
  process.exit(0);
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());

try {
  /* ---------- what the flows will act on ---------- */
  // 1. A compatibility map nobody has approved yet (rows are never deleted; "approved" is `activated_at`).
  await h.admin
    .updateTable('catalogue.compat_map_version')
    .set({ activated_at: null })
    .where('kind', '=', 'style')
    .execute();

  // 2. A product waiting in the verification queue.
  const product = await h.admin
    .selectFrom('catalogue.product')
    .select(['id', 'name'])
    .where('data_status', '=', 'Verified')
    .orderBy('id')
    .limit(1)
    .executeTakeFirstOrThrow();
  await h.admin
    .updateTable('catalogue.product')
    .set({ data_status: 'Ready for Review', verified_by: null, verified_at: null })
    .where('id', '=', product.id)
    .execute();

  // 3. A delivered, receipt-confirmed order line: eligible to be settled.
  const order = await createOrder(h, {
    lines: [{ partner: 'PRT-001', unitPriceFils: 100_000, commissionBps: 1000 }],
  });
  await confirmDirect(h, order.lineIds[0] as string, new Date());
  const now = new Date();
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const partner = await h.admin
    .selectFrom('catalogue.partner')
    .select('trade_name')
    .where('id', '=', order.partnerIds[0] as string)
    .executeTakeFirstOrThrow();

  /* ---------- the real API, as its own process ---------- */
  const databaseUrl = new URL(h.database.url);
  databaseUrl.searchParams.set('options', '-c role=aidooi_app');
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(API_PORT),
    HOST: '127.0.0.1',
    LOG_LEVEL: 'warn',
    DATABASE_URL: databaseUrl.toString(),
    AUTH_SECRET,
    VIEWING_PASS_SECRET,
    RATE_LIMIT_MONEY_PER_MIN: '1000',
  };
  api = spawn('node', ['apps/api/src/main.ts'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  api.on('exit', (c) => {
    if (!stopping) {
      process.stderr.write(`the API exited early (code ${c})\n`);
      process.exit(1);
    }
  });
  await waitFor(`${API}/health/ready`, 60_000);

  /* ---------- three staff, onboarded like real ones ---------- */
  const { ctx, close } = createContext(
    loadConfig({ ...env, DATABASE_URL: databaseUrl.toString() }),
    silentLogger,
  );
  const accounts: Record<string, Account> = {};
  for (const [key, role] of [
    ['admin', 'ops_admin'],
    ['finance1', 'ops_finance'],
    ['finance2', 'ops_finance'],
  ] as const) {
    const email = `${key}@e2e.test`;
    const invitation = await runAsSystem(ctx, (trx) =>
      inviteOpsUser(
        trx,
        { clock: ctx.clock, ids: ctx.ids },
        { email, fullName: `E2E ${key}`, role },
      ),
    );
    await http('POST', '/v1/auth/staff/accept-invite', {
      token: invitation.inviteToken,
      password: PASSWORD,
    });
    const { seed } = await http<{ seed: string }>('POST', '/v1/auth/staff/mfa/enroll', {
      email,
      password: PASSWORD,
    });
    // Confirm with the PREVIOUS 30-second code (accepted: the window is ±1). Codes are single-use and only
    // move forward, so the browser's first sign-in must use a later step than this one.
    await http('POST', '/v1/auth/staff/mfa/verify', {
      email,
      password: PASSWORD,
      totpCode: code(seed, -1),
    });
    accounts[key] = { email, password: PASSWORD, role, seed };
  }
  await close();

  const state = {
    accounts: Object.fromEntries(
      Object.entries(accounts).map(([k, a]) => [
        k,
        { email: a.email, password: a.password, role: a.role },
      ]),
    ),
    productId: product.id,
    productName: product.name,
    partnerName: partner.trade_name,
    period,
  };
  createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/state') return void res.end(JSON.stringify(state));
    if (url.pathname === '/totp') {
      const a = accounts[url.searchParams.get('user') ?? ''];
      if (!a) return void res.writeHead(404).end('{}');
      return void res.end(JSON.stringify({ code: code(a.seed) }));
    }
    res.writeHead(404).end('{}');
  }).listen(STATE_PORT, '127.0.0.1');
} catch (e) {
  process.stderr.write(
    `e2e stack failed to start: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`,
  );
  await stop();
}
