import { ApiProblem, NetworkError } from '@aidooi/api-client';
import {
  ADDRESS_EMIRATES,
  CheckoutSchema,
  IssueFlagSchema,
  IssueStateSchema,
  MasterStatusSchema,
  OrderLineStateSchema,
  ViewingStateSchema,
  StopConfirmationSchema,
} from '@aidooi/contracts';
import { ar } from '../src/i18n/catalogue.ar.ts';
import { en } from '../src/i18n/catalogue.en.ts';
import { memoryKv } from '../src/storage/index.ts';
import { classifyPayError, createIntentKey } from '../src/features/transact/payFlow.ts';
import { createPassCache, type CachedPass } from '../src/features/transact/passCache.ts';
import { pollUntil } from '../src/features/transact/poll.ts';
import { qrMatrix, qrPath, QUIET_ZONE } from '../src/features/transact/QrCode.tsx';
import { remaining, visitSlots, DUBAI_OFFSET_MS } from '../src/features/transact/time.ts';

const problem = (status: number, code: string) => new ApiProblem({ status, code });

describe('remaining', () => {
  it('counts down in a fixed-width clock and stops at zero', () => {
    const until = '2026-10-08T10:00:00.000Z';
    const at = (iso: string) => Date.parse(iso);
    expect(remaining(until, at('2026-10-07T10:00:00.000Z')).clock).toBe('24:00:00');
    expect(remaining(until, at('2026-10-08T09:59:53.000Z'))).toMatchObject({
      clock: '00:00:07',
      expired: false,
    });
    expect(remaining(until, at('2026-10-08T10:00:01.000Z'))).toMatchObject({
      clock: '00:00:00',
      expired: true,
    });
  });
});

describe('visitSlots', () => {
  const now = Date.parse('2026-10-07T07:00:00.000Z'); // 11:00 in Dubai
  const slots = visitSlots(now);

  it('offers only showroom hours in UAE time, never sooner than the lead time', () => {
    for (const s of slots) {
      expect(s.hour).toBeGreaterThanOrEqual(10);
      expect(s.hour).toBeLessThanOrEqual(18);
      expect(Date.parse(s.iso)).toBeGreaterThanOrEqual(now + 90 * 60_000);
      const hourInDubai = new Date(Date.parse(s.iso) + DUBAI_OFFSET_MS).getUTCHours();
      expect(hourInDubai).toBe(s.hour);
    }
  });

  it('skips today’s slots that are too soon (11:00 now → first is 14:00), and covers seven days', () => {
    expect(slots[0]).toMatchObject({ dayOffset: 0, hour: 14 });
    expect(new Set(slots.map((s) => s.dayOffset)).size).toBe(7);
  });

  it('rolls to tomorrow late in the evening', () => {
    const late = visitSlots(Date.parse('2026-10-07T15:30:00.000Z')); // 19:30 Dubai
    expect(late[0]).toMatchObject({ dayOffset: 1, hour: 10 });
  });
});

describe('classifyPayError', () => {
  const cases: [string, unknown, string][] = [
    ['402 declined', problem(402, 'payment_declined'), 'declined'],
    ['409 payment in progress', problem(409, 'payment_in_progress'), 'in-progress'],
    ['409 price approval required', problem(409, 'price_approval_required'), 'checkout-changed'],
    ['409 reservation expired', problem(409, 'reservation_expired'), 'checkout-changed'],
    ['409 superseded', problem(409, 'payment_superseded'), 'restart'],
    ['503 provider unavailable', problem(503, 'payment_provider_unavailable'), 'retry'],
    ['no connection', new NetworkError(new Error('offline')), 'retry'],
    ['guest', problem(401, 'registration_required'), 'sign-in'],
    ['422 validation', problem(422, 'validation_failed'), 'error'],
    ['unknown error', new Error('boom'), 'error'],
  ];
  it.each(cases)('%s', (_label, e, kind) => {
    expect(classifyPayError(e).kind).toBe(kind);
  });
});

describe('createIntentKey', () => {
  it('keeps one key across retries and issues a new one only after reset', () => {
    let n = 0;
    const key = createIntentKey(() => `k${++n}`);
    expect(key.peek()).toBeNull();
    expect(key.current()).toBe('k1');
    expect(key.current()).toBe('k1');
    key.reset();
    expect(key.current()).toBe('k2');
  });
});

describe('pollUntil', () => {
  it('asks again until the server knows, riding out one failed look', async () => {
    let i = 0;
    const slept: number[] = [];
    const v = await pollUntil({
      probe: async () => {
        i++;
        if (i === 2) throw new Error('blip');
        return i === 4 ? 'paid' : undefined;
      },
      intervalMs: 3000,
      sleep: async (ms) => void slept.push(ms),
    });
    expect(v).toBe('paid');
    expect(slept).toEqual([3000, 3000, 3000]);
  });

  it('gives up after the limit rather than waiting forever', async () => {
    let t = 0;
    const v = await pollUntil({
      probe: async () => undefined,
      maxMs: 10_000,
      intervalMs: 3000,
      now: () => t,
      sleep: async (ms) => void (t += ms),
    });
    expect(v).toBeUndefined();
  });
});

describe('QR code', () => {
  it('draws a square matrix that carries the whole token, as a compact path', () => {
    const token = 'v1.eyJ2IjoxLCJ2IjoiYWJjIn0.c2lnbmF0dXJl';
    const m = qrMatrix(token);
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.every((r) => r.length === m.length)).toBe(true);
    const path = qrPath(m, QUIET_ZONE);
    expect(path.startsWith('M')).toBe(true);
    expect(path).not.toMatch(/NaN|undefined/);
    expect(qrPath(m, QUIET_ZONE)).toBe(path); // deterministic
    expect(qrMatrix(`${token}x`)).not.toEqual(m);
  });

  it('merges a run of dark modules into one rectangle', () => {
    expect(qrPath([[true, true, false, true]], 1)).toBe('M1 1h2v1h-2zM4 1h1v1h-1z');
  });
});

describe('pass cache', () => {
  const pass: CachedPass = {
    viewingId: 'v1',
    token: 'tok',
    validFrom: '2026-10-08T06:00:00.000Z',
    validUntil: '2026-10-08T14:00:00.000Z',
    scheduledAt: '2026-10-08T08:00:00.000Z',
    stops: [
      { stopNo: 1, partnerName: 'Marina Living', locationName: 'Showroom', address: 'Al Quoz' },
    ],
    cachedAt: '2026-10-07T10:00:00.000Z',
  };

  it('round-trips and is keyed per viewing', async () => {
    const cache = createPassCache(memoryKv());
    await cache.save(pass);
    expect(await cache.read('v1')).toEqual(pass);
    expect(await cache.read('v2')).toBeNull();
    await cache.remove('v1');
    expect(await cache.read('v1')).toBeNull();
  });

  it('treats a corrupt entry as absent rather than crashing', async () => {
    const kv = memoryKv({ 'aidooi.pass.v1.v1': '{not json' });
    expect(await createPassCache(kv).read('v1')).toBeNull();
  });
});

describe('copy for every server value the transaction screens render', () => {
  const groups: Record<string, readonly string[]> = {
    viewingState: ViewingStateSchema.options,
    stop: StopConfirmationSchema.options,
    checkoutState: CheckoutSchema.shape.state.options,
    lineStatus: CheckoutSchema.shape.lines.element.shape.status.options,
    orderStatus: MasterStatusSchema.options,
    lineState: OrderLineStateSchema.options,
    issueFlag: IssueFlagSchema.options,
    issueHelp: IssueFlagSchema.options,
    issueState: IssueStateSchema.options,
    emirate: ADDRESS_EMIRATES,
    viewing: ['On Display', 'Viewable on Request', 'Not Viewable'],
    'pay.demo': ['ok', 'decline', 'threeDs', 'flaky'],
    'notifications.why': ['viewing', 'price', 'delivery'],
    rules: ['deposit', 'purchase', 'noPurchase', 'noShow'],
  };
  for (const [prefix, values] of Object.entries(groups)) {
    it(`${prefix}.* exists in English and Arabic`, () => {
      for (const v of values) {
        const k = `${prefix}.${v}`;
        expect(en).toHaveProperty([k]);
        expect(ar).toHaveProperty([k]);
      }
    });
  }
});
