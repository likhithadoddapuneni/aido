import { describe, expect, it } from 'vitest';
import { aed, fixedClock, type Fils } from '@aidooi/domain';
import { GatewayUnavailable, type PaymentGateway } from '../src/payments/gateway.ts';

export interface ContractHarness {
  gateway: PaymentGateway;
  /** Tokens that make the processor behave in the named way. A real adapter maps these to sandbox cards. */
  tokens: { ok: string; decline: string; threeDs: string };
  /** Advance the processor past the authorisation hold, if it can be simulated. */
  expireHold?: (providerRef: string) => void;
}

/**
 * Behaviour every PaymentGateway adapter must have. Run against the mock today; run the same
 * suite against the provider's sandbox before the first real-money launch.
 */
export function gatewayContract(name: string, make: () => ContractHarness): void {
  describe(`PaymentGateway contract: ${name}`, () => {
    const amount: Fils = aed(1000);
    let n = 0;
    const key = (p: string) => `${p}-${++n}-${Math.random().toString(36).slice(2)}`;

    async function authorized(h: ContractHarness) {
      const r = await h.gateway.authorize({
        idempotencyKey: key('a'),
        amount,
        paymentToken: h.tokens.ok,
        reference: 'order-1',
      });
      if (r.status !== 'authorized') throw new Error('expected authorized');
      return r;
    }

    it('authorise → capture → refund (partial, then remainder)', async () => {
      const h = make();
      const a = await authorized(h);
      const c = await h.gateway.capture({
        idempotencyKey: key('c'),
        providerRef: a.providerRef,
        amount,
      });
      expect(c).toMatchObject({ status: 'captured', amount });
      const r1 = await h.gateway.refund({
        idempotencyKey: key('r'),
        providerRef: a.providerRef,
        amount: aed(300),
      });
      expect(r1).toMatchObject({ status: 'refunded', amount: aed(300) });
      const r2 = await h.gateway.refund({
        idempotencyKey: key('r'),
        providerRef: a.providerRef,
        amount: aed(700),
      });
      expect(r2).toMatchObject({ status: 'refunded' });
    });

    it('is idempotent: the same key returns the same outcome and acts once', async () => {
      const h = make();
      const a = await authorized(h);
      const k = key('c');
      const first = await h.gateway.capture({
        idempotencyKey: k,
        providerRef: a.providerRef,
        amount,
      });
      const again = await h.gateway.capture({
        idempotencyKey: k,
        providerRef: a.providerRef,
        amount,
      });
      expect(again).toEqual(first);
      const k2 = key('r');
      const r1 = await h.gateway.refund({
        idempotencyKey: k2,
        providerRef: a.providerRef,
        amount: aed(100),
      });
      const r2 = await h.gateway.refund({
        idempotencyKey: k2,
        providerRef: a.providerRef,
        amount: aed(100),
      });
      expect(r2).toEqual(r1);
      // The replay did not refund twice: 900 can still be refunded, 901 cannot.
      expect(
        await h.gateway.refund({
          idempotencyKey: key('r'),
          providerRef: a.providerRef,
          amount: aed(901),
        }),
      ).toMatchObject({ status: 'failed', code: 'amount_exceeds_captured' });
      expect(
        await h.gateway.refund({
          idempotencyKey: key('r'),
          providerRef: a.providerRef,
          amount: aed(900),
        }),
      ).toMatchObject({ status: 'refunded' });
    });

    it('cannot capture twice, over-capture, or capture after a void', async () => {
      const h = make();
      const a = await authorized(h);
      expect(
        await h.gateway.capture({
          idempotencyKey: key('c'),
          providerRef: a.providerRef,
          amount: aed(1001),
        }),
      ).toMatchObject({ status: 'failed', code: 'amount_exceeds_authorization' });
      expect(
        await h.gateway.capture({ idempotencyKey: key('c'), providerRef: a.providerRef, amount }),
      ).toMatchObject({ status: 'captured' });
      expect(
        await h.gateway.capture({ idempotencyKey: key('c'), providerRef: a.providerRef, amount }),
      ).toMatchObject({ status: 'failed', code: 'already_captured' });
      const b = await authorized(h);
      expect(
        await h.gateway.void({ idempotencyKey: key('v'), providerRef: b.providerRef }),
      ).toEqual({ status: 'voided' });
      expect(
        await h.gateway.capture({ idempotencyKey: key('c'), providerRef: b.providerRef, amount }),
      ).toMatchObject({ status: 'failed', code: 'authorization_voided' });
    });

    it('cannot void what was captured; cannot refund what was not', async () => {
      const h = make();
      const a = await authorized(h);
      expect(
        await h.gateway.refund({ idempotencyKey: key('r'), providerRef: a.providerRef, amount }),
      ).toMatchObject({ status: 'failed', code: 'not_captured' });
      await h.gateway.capture({ idempotencyKey: key('c'), providerRef: a.providerRef, amount });
      expect(
        await h.gateway.void({ idempotencyKey: key('v'), providerRef: a.providerRef }),
      ).toMatchObject({ status: 'failed', code: 'already_captured' });
    });

    it('declines are outcomes, not exceptions', async () => {
      const h = make();
      const r = await h.gateway.authorize({
        idempotencyKey: key('a'),
        amount,
        paymentToken: h.tokens.decline,
        reference: 'x',
      });
      expect(r).toMatchObject({ status: 'declined' });
    });

    it('3-D Secure returns a challenge rather than a result', async () => {
      const h = make();
      const r = await h.gateway.authorize({
        idempotencyKey: key('a'),
        amount,
        paymentToken: h.tokens.threeDs,
        reference: 'x',
      });
      expect(r.status).toBe('requires_action');
    });

    it('rejects webhooks with a bad signature', () => {
      const h = make();
      expect(() =>
        h.gateway.parseWebhook('{"id":"e","type":"capture.succeeded"}', 'deadbeef'),
      ).toThrow();
    });

    it.skipIf(!make().expireHold)('an expired authorisation cannot be captured', async () => {
      const h = make();
      const a = await authorized(h);
      h.expireHold?.(a.providerRef);
      expect(
        await h.gateway.capture({ idempotencyKey: key('c'), providerRef: a.providerRef, amount }),
      ).toMatchObject({ status: 'failed', code: 'authorization_expired' });
    });

    it('GatewayUnavailable is a typed, retryable error', () => {
      expect(new GatewayUnavailable()).toBeInstanceOf(Error);
    });
  });
}

export const newClock = () => fixedClock(1_800_000_000_000);
