import { createHmac, timingSafeEqual } from 'node:crypto';
import { fils, instant, type Fils } from '@aidooi/domain';
import {
  GatewayUnavailable,
  type AuthorizeRequest,
  type AuthorizeResult,
  type CaptureRequest,
  type CaptureResult,
  type DeclineCode,
  type GatewayDeps,
  type GatewayEvent,
  type PaymentGateway,
  type RefundRequest,
  type RefundResult,
  type VoidRequest,
  type VoidResult,
} from './gateway.ts';

/**
 * Magic payment tokens (the same idea as a real provider's test cards) select a behaviour:
 *
 *   tok_ok                 authorises and captures normally
 *   tok_3ds                requires a 3-D Secure challenge; `completeChallenge()` finishes it
 *   tok_decline            card_declined      tok_insufficient   insufficient_funds
 *   tok_capture_fails      authorises, but capture fails with processor_error
 *   tok_flaky_once         the first call of each operation throws GatewayUnavailable *after*
 *                          the provider acted (the nasty case: a timeout with the side effect done)
 */
export const TEST_TOKENS = {
  ok: 'tok_ok',
  threeDs: 'tok_3ds',
  decline: 'tok_decline',
  insufficient: 'tok_insufficient',
  captureFails: 'tok_capture_fails',
  flakyOnce: 'tok_flaky_once',
} as const;

/** Real card authorisation holds are time-limited; the saga must finish well inside this. */
export const AUTH_HOLD_MS = 7 * 24 * 3_600_000;

interface Auth {
  ref: string;
  token: string;
  amount: Fils;
  state: 'pending_action' | 'authorized' | 'captured' | 'voided' | 'failed';
  captured: number;
  refunded: number;
  expiresAt: number;
}

/**
 * An in-memory processor faithful enough to catch saga bugs: it enforces idempotency, refuses to
 * capture twice or over-capture, expires authorisations, bounds refunds by what was captured, and
 * emits signed webhooks. It is used by every environment until a real provider is chosen.
 */
export class MockGateway implements PaymentGateway {
  private readonly deps: GatewayDeps;
  private readonly secret: string;
  private readonly auths = new Map<string, Auth>();
  private readonly byKey = new Map<string, unknown>();
  private readonly flaked = new Set<string>();
  private readonly outbox: GatewayEvent[] = [];
  private seq = 0;
  /** Every call that reached the processor (not replays), for assertions. */
  readonly calls: { op: string; key: string }[] = [];

  constructor(deps: GatewayDeps, secret = 'mock-webhook-secret') {
    this.deps = deps;
    this.secret = secret;
  }

  private now = (): number => this.deps.clock.now();

  /** Run `act` at most once per idempotency key; replays return the stored outcome. */
  private once<T>(op: string, key: string, token: string | null, act: () => T): T {
    const k = `${op}:${key}`;
    if (this.byKey.has(k)) return this.byKey.get(k) as T;
    this.calls.push({ op, key });
    const result = act();
    this.byKey.set(k, result);
    if (token === TEST_TOKENS.flakyOnce && !this.flaked.has(k)) {
      this.flaked.add(k);
      throw new GatewayUnavailable('simulated timeout after the provider acted');
    }
    return result;
  }

  private event(e: GatewayEvent): void {
    this.outbox.push(e);
  }

  async authorize(req: AuthorizeRequest): Promise<AuthorizeResult> {
    return this.once('authorize', req.idempotencyKey, req.paymentToken, (): AuthorizeResult => {
      const decline = (code: DeclineCode): AuthorizeResult => ({ status: 'declined', code });
      if (req.paymentToken === TEST_TOKENS.decline) return decline('card_declined');
      if (req.paymentToken === TEST_TOKENS.insufficient) return decline('insufficient_funds');
      if (req.amount <= 0) throw new RangeError('Amount must be positive');

      const ref = `mock_auth_${String(++this.seq).padStart(6, '0')}`;
      const expiresAt = this.now() + AUTH_HOLD_MS;
      const auth: Auth = {
        ref,
        token: req.paymentToken,
        amount: req.amount,
        state: 'authorized',
        captured: 0,
        refunded: 0,
        expiresAt,
      };
      this.auths.set(ref, auth);
      if (req.paymentToken === TEST_TOKENS.threeDs) {
        auth.state = 'pending_action';
        return {
          status: 'requires_action',
          providerRef: ref,
          actionUrl: `https://mock.invalid/3ds/${ref}`,
        };
      }
      this.event({ id: `evt_${++this.seq}`, type: 'authorization.succeeded', providerRef: ref });
      return { status: 'authorized', providerRef: ref, expiresAt: instant(expiresAt) };
    });
  }

  /** Test control: the buyer completes (or fails) the 3-D Secure challenge. */
  completeChallenge(providerRef: string, outcome: 'success' | 'failure' = 'success'): void {
    const a = this.auths.get(providerRef);
    if (!a || a.state !== 'pending_action')
      throw new Error('No pending challenge for this reference');
    if (outcome === 'success') {
      a.state = 'authorized';
      this.event({ id: `evt_${++this.seq}`, type: 'authorization.succeeded', providerRef });
    } else {
      a.state = 'failed';
      this.event({
        id: `evt_${++this.seq}`,
        type: 'authorization.failed',
        providerRef,
        code: 'authentication_failed',
      });
    }
  }

  async capture(req: CaptureRequest): Promise<CaptureResult> {
    const auth = this.auths.get(req.providerRef);
    return this.once('capture', req.idempotencyKey, auth?.token ?? null, (): CaptureResult => {
      if (!auth || auth.state === 'failed' || auth.state === 'pending_action')
        return { status: 'failed', code: 'processor_error' };
      if (auth.state === 'voided') return { status: 'failed', code: 'authorization_voided' };
      if (auth.state === 'captured') return { status: 'failed', code: 'already_captured' };
      if (this.now() > auth.expiresAt) return { status: 'failed', code: 'authorization_expired' };
      if (req.amount > auth.amount)
        return { status: 'failed', code: 'amount_exceeds_authorization' };
      if (auth.token === TEST_TOKENS.captureFails)
        return { status: 'failed', code: 'processor_error' };
      auth.state = 'captured';
      auth.captured = req.amount;
      this.event({
        id: `evt_${++this.seq}`,
        type: 'capture.succeeded',
        providerRef: auth.ref,
        amount: req.amount,
      });
      return { status: 'captured', providerRef: auth.ref, amount: req.amount };
    });
  }

  async void(req: VoidRequest): Promise<VoidResult> {
    const auth = this.auths.get(req.providerRef);
    return this.once('void', req.idempotencyKey, auth?.token ?? null, (): VoidResult => {
      if (!auth) return { status: 'failed', code: 'unknown_authorization' };
      if (auth.state === 'captured') return { status: 'failed', code: 'already_captured' };
      auth.state = 'voided';
      return { status: 'voided' };
    });
  }

  async refund(req: RefundRequest): Promise<RefundResult> {
    const auth = this.auths.get(req.providerRef);
    return this.once('refund', req.idempotencyKey, auth?.token ?? null, (): RefundResult => {
      if (!auth || auth.state !== 'captured') return { status: 'failed', code: 'not_captured' };
      if (auth.refunded + req.amount > auth.captured)
        return { status: 'failed', code: 'amount_exceeds_captured' };
      auth.refunded += req.amount;
      this.event({
        id: `evt_${++this.seq}`,
        type: 'refund.succeeded',
        providerRef: auth.ref,
        amount: req.amount,
      });
      return { status: 'refunded', refundRef: `mock_refund_${++this.seq}`, amount: req.amount };
    });
  }

  /** Test inspection: what the processor believes about a reference. */
  inspect(providerRef: string): Readonly<Auth> | undefined {
    return this.auths.get(providerRef);
  }

  /** Test control: advance the processor past an authorisation hold. */
  expireAuthorization(providerRef: string): void {
    const a = this.auths.get(providerRef);
    if (a) a.expiresAt = this.now() - 1;
  }

  /** Webhooks the processor has emitted since the last drain, signed as a real provider would. */
  drainWebhooks(): { body: string; signature: string }[] {
    return this.outbox.splice(0).map((e) => {
      const body = JSON.stringify(e);
      return { body, signature: this.sign(body) };
    });
  }

  sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('hex');
  }

  parseWebhook(rawBody: string, signature: string): GatewayEvent {
    const expected = Buffer.from(this.sign(rawBody), 'hex');
    const given = Buffer.from(signature, 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new Error('Invalid webhook signature');
    }
    const e = JSON.parse(rawBody) as GatewayEvent;
    return 'amount' in e ? { ...e, amount: fils(e.amount) } : e;
  }
}
