import type { FastifyRequest } from 'fastify';
import { FakeMediaStorage } from './media.ts';
import { createDepositCreditPort } from '../../src/modules/viewing/credit-port.ts';
import type { Kysely } from 'kysely';
import {
  createTestDatabase,
  seedDatabase,
  type SeededDatabase,
  type TestDatabase,
} from '@aidooi/db/testing';
import type { DB } from '@aidooi/db';
import { instant, type Clock } from '@aidooi/domain';
import { buildApp, type App } from '../../src/app.ts';
import { loadConfig } from '../../src/config.ts';
import type { AppContext } from '../../src/context.ts';
import type { ApiActor } from '../../src/http/actor.ts';
import { uuidV7Generator } from '../../src/ids.ts';
import { JwtAuthenticator } from '../../src/modules/auth/authenticator.ts';
import { FakeIdTokens } from './auth-fakes.ts';
import { MockGateway } from '../../src/payments/mock-gateway.ts';
import type { Authenticator, Notification, Notifier, OtpSender } from '../../src/ports.ts';

const HOUR = 3_600_000;

/** A clock tests can move. It starts at the real time because the database's own `now()` does too. */
export class TestClock implements Clock {
  private t = Date.now();
  now() {
    return instant(this.t);
  }
  advanceHours(h: number): void {
    this.t += h * HOUR;
  }
  /** Undo any advance: tests that move time must not leak it into the next test. */
  resetToNow(): void {
    this.t = Date.now();
  }
}

/** Tests identify the caller with an `x-test-actor` header holding an `ApiActor` as JSON. */
/** A test actor header wins; otherwise the real JWT authenticator runs, so auth tests exercise production code. */
class HeaderAuthenticator implements Authenticator {
  private readonly fallback: Authenticator;
  constructor(fallback: Authenticator) {
    this.fallback = fallback;
  }

  async authenticate(req: FastifyRequest): Promise<ApiActor | null> {
    const h = req.headers['x-test-actor'];
    return typeof h === 'string' ? (JSON.parse(h) as ApiActor) : this.fallback.authenticate(req);
  }
}

export class RecordingNotifier implements Notifier {
  readonly sent: Notification[] = [];
  async send(n: Notification): Promise<void> {
    if (!this.sent.some((s) => s.dedupeKey === n.dedupeKey)) this.sent.push(n);
  }
  ofTemplate(t: string) {
    return this.sent.filter((s) => s.template === t);
  }
}

export class RecordingOtp implements OtpSender {
  readonly codes: { channel: string; destination: string; code: string }[] = [];
  async send(
    channel: 'sms' | 'whatsapp' | 'email',
    destination: string,
    code: string,
  ): Promise<void> {
    this.codes.push({ channel, destination, code });
  }
  last(destination: string): string {
    const c = [...this.codes].reverse().find((x) => x.destination === destination);
    if (!c) throw new Error(`No OTP was sent to ${destination}`);
    return c.code;
  }
}

export interface Harness {
  readonly app: App;
  readonly ctx: AppContext;
  readonly database: TestDatabase;
  /** Connected as the owner; bypasses nothing it is denied, but is not subject to the app role's grants. */
  readonly admin: Kysely<DB>;
  readonly clock: TestClock;
  readonly gateway: MockGateway;
  readonly notifier: RecordingNotifier;
  readonly otp: RecordingOtp;
  readonly idTokens: FakeIdTokens;
  readonly media: FakeMediaStorage;
  readonly seeded: SeededDatabase | null;
  /** Headers that make a request come from `actor`. */
  as(actor: ApiActor | null, extra?: Record<string, string>): Record<string, string>;
  close(): Promise<void>;
}

export async function startHarness(
  opts: { seed?: boolean; gateway?: (clock: Clock) => MockGateway } = {},
): Promise<Harness> {
  const database = await createTestDatabase();
  const seeded = opts.seed === false ? null : await seedDatabase(database.admin);
  const clock = new TestClock();
  const gateway = opts.gateway ? opts.gateway(clock) : new MockGateway({ clock });
  const notifier = new RecordingNotifier();
  const otp = new RecordingOtp();
  const idTokens = new FakeIdTokens();
  const media = new FakeMediaStorage();
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: process.env['TEST_LOG_LEVEL'] ?? 'silent',
    PAYMENT_WEBHOOK_SECRET: 'test-webhook-secret-0123456789',
    RATE_LIMIT_MONEY_PER_MIN: '100000',
  });
  const ctx: AppContext = {
    config,
    clock,
    db: database.app,
    ids: uuidV7Generator,
    gateway,
    notifier,
    otp,
    depositCredit: createDepositCreditPort(() => ctx),
    media,
    authenticator: new HeaderAuthenticator(
      new JwtAuthenticator({ db: database.app, config, clock }),
    ),
    idTokens,
  };
  const app = await buildApp({ ctx });
  await app.ready();
  return {
    app,
    ctx,
    database,
    admin: database.admin,
    clock,
    gateway,
    notifier,
    otp,
    idTokens,
    media,
    seeded,
    as: (actor, extra = {}) => ({
      ...(actor ? { 'x-test-actor': JSON.stringify(actor) } : {}),
      ...extra,
    }),
    close: async () => {
      await app.close();
      await database.drop();
    },
  };
}

export const guest = (id = 'a0000000-0000-4000-8000-000000000001'): ApiActor => ({
  kind: 'buyer',
  customerId: null,
  guestSessionId: id,
});
export const buyer = (customerId: string): ApiActor => ({
  kind: 'buyer',
  customerId,
  guestSessionId: null,
});
export const seller = (
  partnerId: string,
  sellerUserId = 'b0000000-0000-4000-8000-000000000001',
  role: 'seller_owner' | 'seller_manager' | 'seller_staff' = 'seller_owner',
): ApiActor => ({
  kind: 'seller',
  partnerId,
  sellerUserId,
  role,
  locationId: null,
});
export const ops = (
  opsUserId: string,
  role: 'ops_admin' | 'ops_catalogue' | 'ops_support' | 'ops_finance' = 'ops_admin',
): ApiActor => ({ kind: 'ops', opsUserId, role });
