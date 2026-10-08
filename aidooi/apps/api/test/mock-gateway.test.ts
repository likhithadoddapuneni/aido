import { describe, expect, it } from 'vitest';
import { aed } from '@aidooi/domain';
import { GatewayUnavailable } from '../src/payments/gateway.ts';
import { MockGateway, TEST_TOKENS } from '../src/payments/mock-gateway.ts';
import { gatewayContract, newClock } from './gateway.contract.ts';

gatewayContract('MockGateway', () => {
  const g = new MockGateway({ clock: newClock() });
  return {
    gateway: g,
    tokens: { ok: TEST_TOKENS.ok, decline: TEST_TOKENS.decline, threeDs: TEST_TOKENS.threeDs },
    expireHold: (ref) => g.expireAuthorization(ref),
  };
});

describe('MockGateway behaviours the saga relies on', () => {
  const setup = () => {
    const clock = newClock();
    return { clock, g: new MockGateway({ clock }) };
  };

  it('a flaky timeout happens AFTER the provider acted; the retry returns the original outcome', async () => {
    const { g } = setup();
    const req = {
      idempotencyKey: 'k1',
      amount: aed(500),
      paymentToken: TEST_TOKENS.flakyOnce,
      reference: 'r',
    };
    await expect(g.authorize(req)).rejects.toBeInstanceOf(GatewayUnavailable);
    const retry = await g.authorize(req);
    expect(retry.status).toBe('authorized');
    expect(g.calls.filter((c) => c.op === 'authorize')).toHaveLength(1); // the provider acted exactly once
  });

  it('3-D Secure completes through a signed webhook', async () => {
    const { g } = setup();
    const r = await g.authorize({
      idempotencyKey: 'k',
      amount: aed(10),
      paymentToken: TEST_TOKENS.threeDs,
      reference: 'r',
    });
    if (r.status !== 'requires_action') throw new Error('expected a challenge');
    expect(
      await g.capture({ idempotencyKey: 'c0', providerRef: r.providerRef, amount: aed(10) }),
    ).toMatchObject({ status: 'failed' });
    g.completeChallenge(r.providerRef);
    const hooks = g.drainWebhooks();
    const evt = g.parseWebhook(hooks[0]!.body, hooks[0]!.signature);
    expect(evt).toMatchObject({ type: 'authorization.succeeded', providerRef: r.providerRef });
    expect(
      await g.capture({ idempotencyKey: 'c1', providerRef: r.providerRef, amount: aed(10) }),
    ).toMatchObject({ status: 'captured' });
  });

  it('a failed challenge ends the authorisation', async () => {
    const { g } = setup();
    const r = await g.authorize({
      idempotencyKey: 'k',
      amount: aed(10),
      paymentToken: TEST_TOKENS.threeDs,
      reference: 'r',
    });
    if (r.status !== 'requires_action') throw new Error('expected a challenge');
    g.completeChallenge(r.providerRef, 'failure');
    const evt = g.parseWebhook(...(Object.values(g.drainWebhooks()[0]!) as [string, string]));
    expect(evt.type).toBe('authorization.failed');
  });

  it('tampered webhook bodies are rejected', async () => {
    const { g } = setup();
    await g.authorize({
      idempotencyKey: 'k',
      amount: aed(10),
      paymentToken: TEST_TOKENS.ok,
      reference: 'r',
    });
    const hook = g.drainWebhooks()[0]!;
    expect(() =>
      g.parseWebhook(hook.body.replace('succeeded', 'failed__'), hook.signature),
    ).toThrow(/signature/);
  });

  it('a capture failure leaves the authorisation voidable', async () => {
    const { g } = setup();
    const a = await g.authorize({
      idempotencyKey: 'k',
      amount: aed(10),
      paymentToken: TEST_TOKENS.captureFails,
      reference: 'r',
    });
    if (a.status !== 'authorized') throw new Error('expected authorized');
    expect(
      await g.capture({ idempotencyKey: 'c', providerRef: a.providerRef, amount: aed(10) }),
    ).toMatchObject({ status: 'failed', code: 'processor_error' });
    expect(await g.void({ idempotencyKey: 'v', providerRef: a.providerRef })).toEqual({
      status: 'voided',
    });
  });
});
