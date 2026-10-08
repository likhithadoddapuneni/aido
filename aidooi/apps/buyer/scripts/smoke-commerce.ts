/**
 * Real-API smoke test for the buyer's transaction layer. Boots the actual API against a scratch Postgres
 * database seeded by `@aidooi/db/testing`, then drives the services the screens use, over real HTTP:
 *
 *   sign in → composition → viewing request → sellers confirm (one declines, in a second run) → deposit
 *   → pass → visit → checkout with the deposit credited → a declined card → pay → order → report an
 *   issue → confirm receipt → account (addresses, consent, devices, export, erasure)
 *   … and a second purchase with a flaky payment provider, proving one tap is one charge.
 *
 * Every response is parsed with the contract's Zod schema, so drift between server and app fails here.
 * Sellers act through the harness's test-actor header: the seller apps are not part of this script.
 *
 *   pnpm --filter @aidooi/buyer smoke:commerce   (needs the local Postgres from `docker compose up postgres`)
 */
import { randomUUID } from 'node:crypto';
import {
  AddressSchema,
  BuyerOrderSchema,
  BuyerSessionSchema,
  CheckoutSchema,
  CompositionSchema,
  CustomerSchema,
  DataExportSchema,
  DepositResultSchema,
  MeSchema,
  PassSchema,
  PayResponseSchema,
  RecommendationResponseSchema,
  ViewingSchema,
} from '@aidooi/contracts';
import { ApiProblem, createApi, memoryStore, withIntent } from '@aidooi/api-client';
import { startHarness } from '../../api/test/support/harness.ts';
import { inDays, newSeller } from '../../api/test/support/viewing.ts';
import { discoveryServices } from '../src/api/services.ts';
import { classifyPayError } from '../src/features/transact/payFlow.ts';
import { transactServices } from '../src/features/transact/services.ts';

const PHONE = '+971501234567';
const POLICY_VERSION = '2026-01';
const delivery = {
  recipientName: 'Amal Hassan',
  phone: PHONE,
  line1: 'Villa 12, Street 4, Al Barsha',
  area: 'Al Barsha',
  emirate: 'Dubai' as const,
};

let step = 0;
const ok = (what: string, detail = '') =>
  console.log(`  ${String(++step).padStart(2)}. ${what}${detail ? ` — ${detail}` : ''}`);
function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`smoke failed: ${message}`);
}
const refusal = async (p: Promise<unknown>): Promise<ApiProblem> => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiProblem) return e;
    throw e;
  }
  throw new Error('smoke failed: the server was expected to refuse this');
};

const harness = await startHarness();
let failed = false;
try {
  await harness.app.listen({ port: 0, host: '127.0.0.1' });
  const address = harness.app.server.address();
  assert(address && typeof address === 'object', 'server did not bind');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  console.log(`commerce smoke against ${baseUrl} (scratch database ${harness.database.name})`);

  // Every payment request's idempotency key, as it left the app.
  const payKeys: string[] = [];
  const recording: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    if (req.method === 'POST' && /\/pay$|\/deposit$/.test(new URL(req.url).pathname)) {
      payKeys.push(req.headers.get('idempotency-key') ?? '');
    }
    return fetch(req);
  };
  const store = memoryStore();
  const api = createApi({
    baseUrl,
    store,
    appVersion: '0.0.0',
    onSignedOut: () => undefined,
    uuid: randomUUID,
    fetch: recording,
  });
  const disco = discoveryServices(api);
  const tx = transactServices(api);

  const sellerCall = async (
    actor: Awaited<ReturnType<typeof newSeller>>,
    method: string,
    path: string,
    body?: unknown,
  ) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...harness.as(actor) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    assert(res.ok, `seller ${method} ${path} → ${res.status} ${text}`);
    return text ? (JSON.parse(text) as unknown) : null;
  };

  // 1. Sign in and get a composition (the discovery flow, already covered by `smoke`).
  const guest = await disco.createGuest();
  await store.write({ kind: 'guest', guestToken: guest.guestToken });
  const blocked = await refusal(tx.createViewing({ compositionId: randomUUID() }, randomUUID()));
  assert(blocked.code === 'registration_required', `a guest was refused with ${blocked.code}`);
  ok('a guest is told to sign in before a viewing', blocked.code);

  await disco.requestOtp(PHONE);
  const session = BuyerSessionSchema.parse(
    await disco.verifyOtp({
      phone: PHONE,
      code: harness.otp.last(PHONE),
      guestToken: guest.guestToken,
      policyVersion: POLICY_VERSION,
    }),
  );
  await store.write({
    kind: 'user',
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  });
  ok('signed in');

  const project = await disco.createProject({
    pathId: 'livingRoom',
    lengthM: 5,
    widthM: 4,
    style: 'modern',
    colour: 'grey',
    tier: 'Standard',
  });
  const rec = RecommendationResponseSchema.parse(await disco.recommend(project.id));
  const composition = CompositionSchema.parse(
    await disco.getComposition(rec.runs[0]!.compositions[0]!.id),
  );
  const viewable = composition.items.filter((i) => i.offer.viewingStatus !== 'Not Viewable');
  assert(viewable.length > 0, 'the composition has viewable products');
  ok('composition', `${composition.items.length} items, ${viewable.length} viewable`);

  // Showrooms. A stop whose products are on display and freshly confirmed is confirmed on the spot;
  // the rest wait for their seller. Stops are read from the database, not guessed from the products.
  const sellers = new Map<string, Awaited<ReturnType<typeof newSeller>>>();
  const sellerFor = async (partnerId: string) => {
    let actor = sellers.get(partnerId);
    if (!actor) sellers.set(partnerId, (actor = await newSeller(harness, partnerId)));
    return actor;
  };
  const stopsOf = (viewingId: string) =>
    harness.admin
      .selectFrom('viewing.viewing_stop')
      .select(['partner_id', 'confirmation_state'])
      .where('viewing_request_id', '=', viewingId)
      .orderBy('stop_no')
      .execute();
  const respond = async (partnerId: string, response: 'Confirmed' | 'Declined') => {
    const actor = await sellerFor(partnerId);
    const tasks = (await sellerCall(actor, 'GET', '/v1/seller/viewing-tasks')) as {
      id: string;
      response: string | null;
    }[];
    for (const t of tasks.filter((x) => x.response === null)) {
      await sellerCall(actor, 'POST', `/v1/seller/viewing-tasks/${t.id}/respond`, {
        response,
        displayConfirmed: true,
      });
    }
  };
  const confirmPending = async (viewingId: string) => {
    for (const st of (await stopsOf(viewingId)).filter((x) => x.confirmation_state === 'Pending')) {
      await respond(st.partner_id, 'Confirmed');
    }
  };

  // 2. A showroom declines: the buyer decides (needs a pending stop to decline and another stop to keep).
  const trial = ViewingSchema.parse(
    await tx.createViewing(
      { compositionId: composition.id, itemSlotKeys: viewable.map((i) => i.slotKey) },
      randomUUID(),
    ),
  );
  const trialStops = await stopsOf(trial.id);
  const toDecline = trialStops.find((x) => x.confirmation_state === 'Pending');
  if (toDecline && trialStops.length >= 2) {
    await respond(toDecline.partner_id, 'Declined');
    await confirmPending(trial.id);
    const decided = ViewingSchema.parse(await tx.getViewing(trial.id));
    assert(decided.needsDecision, `needsDecision after a decline (state ${decided.state})`);
    ok('a declined stop is left for the buyer to decide', decided.state);
    const cont = ViewingSchema.parse(await tx.continueViewing(trial.id));
    assert(cont.state === 'Awaiting Deposit' && !cont.needsDecision, `continued (${cont.state})`);
    const kept = cont.stops.filter((x) => x.confirmation !== 'Declined');
    assert(
      kept.length === cont.stops.length - 1,
      'the declined stop stays listed, marked Declined',
    );
    const keptBase = kept
      .flatMap((x) => x.products)
      .reduce((n, p) => n + p.unitPrice * p.quantity, 0);
    assert(
      cont.depositQuote.base === keptBase,
      `the quote covers only the stops still visited (${cont.depositQuote.base} vs ${keptBase})`,
    );
    ok(
      'continue without the declined stop',
      `${kept.length} of ${cont.stops.length} stop(s) kept, deposit quote ${cont.depositQuote.amount} fils on ${cont.depositQuote.base}`,
    );
    const cancelled = ViewingSchema.parse(await tx.cancelViewing(trial.id));
    assert(cancelled.state === 'Cancelled', 'cancelled');
    ok('cancelling before paying costs nothing', cancelled.state);
  } else {
    await tx.cancelViewing(trial.id);
    ok(
      'no stop was left pending to decline in this composition (skipped; covered by the API tests)',
    );
  }

  // 3. The viewing that goes ahead.
  const viewing = ViewingSchema.parse(
    await tx.createViewing(
      { compositionId: composition.id, itemSlotKeys: viewable.map((i) => i.slotKey) },
      randomUUID(),
    ),
  );
  assert(viewing.state === 'Awaiting Seller Confirmation', `new viewing is ${viewing.state}`);
  await confirmPending(viewing.id);
  const quoted = ViewingSchema.parse(await tx.getViewing(viewing.id));
  assert(quoted.state === 'Awaiting Deposit', `after confirmations: ${quoted.state}`);
  assert(quoted.depositQuote.amount <= 50_000, 'deposit capped at AED 500');
  assert(
    quoted.depositQuote.amount ===
      Math.min(Math.floor((quoted.depositQuote.base * 5 + 50) / 100), 50_000),
    'quote is 5% of the base',
  );
  ok(
    'sellers confirmed; deposit quoted by the server',
    `${quoted.depositQuote.amount} fils on ${quoted.depositQuote.base}${quoted.depositQuote.capped ? ' (capped)' : ''}`,
  );

  const scheduledAt = inDays(harness, 1 / 12); // two hours from now
  const declined = await refusal(
    tx.payDeposit(viewing.id, { paymentToken: 'tok_decline', scheduledAt }, randomUUID()),
  );
  assert(
    classifyPayError(declined).kind === 'declined',
    `decline classified as ${classifyPayError(declined).kind}`,
  );
  ok('a declined deposit card is refused and classified', declined.code);

  const depositKey = randomUUID();
  const paid = DepositResultSchema.parse(
    await tx.payDeposit(viewing.id, { paymentToken: 'tok_ok', scheduledAt }, depositKey),
  );
  assert(paid.status === 'confirmed', `deposit ${paid.status}`);
  const replay = DepositResultSchema.parse(
    await tx.payDeposit(viewing.id, { paymentToken: 'tok_ok', scheduledAt }, depositKey),
  );
  assert(replay.status === 'confirmed', 'a replay of the same key returns the original outcome');
  ok('deposit paid; a replay with the same key returns the same outcome');

  const pass = PassSchema.parse(await tx.getPass(viewing.id));
  assert(pass.token.length > 20, 'a pass token');
  ok('QR pass issued', `valid until ${pass.validUntil}`);

  // 4. The visit: showrooms scan the pass and mark it complete.
  for (const st of await stopsOf(viewing.id)) {
    const actor = await sellerFor(st.partner_id);
    await sellerCall(actor, 'POST', '/v1/seller/viewings/scan', { token: pass.token });
    await sellerCall(actor, 'POST', `/v1/seller/viewings/${viewing.id}/outcome`, {
      outcome: 'Completed',
    });
  }
  const done = ViewingSchema.parse(await tx.getViewing(viewing.id));
  assert(done.state === 'Completed', `viewing ${done.state}`);
  ok('visit completed');

  // 5. Buy, with the deposit credited.
  const offerIds = composition.items.map((i) => i.offer.id);
  await harness.admin
    .updateTable('catalogue.seller_offer')
    .set({ availability: 'In Stock', stock_qty: 50 })
    .where('id', 'in', offerIds)
    .execute();
  const checkout = CheckoutSchema.parse(
    await tx.startCheckout(
      {
        source: { kind: 'composition', compositionId: composition.id },
        viewingRequestId: viewing.id,
      },
      randomUUID(),
    ),
  );
  assert(checkout.state === 'Ready to Pay', `checkout ${checkout.state}`);
  assert(checkout.depositCredit === quoted.depositQuote.amount, 'the deposit is credited');
  assert(checkout.payable === checkout.total - checkout.depositCredit, 'payable = total − credit');
  assert(checkout.expiresAt !== null, 'a purchase window');
  ok(
    'checkout ready to pay',
    `total ${checkout.total}, credit ${checkout.depositCredit}, payable ${checkout.payable}, window until ${checkout.expiresAt}`,
  );

  const refused = await refusal(tx.approvePrices(checkout.id, checkout.total + 1));
  ok(
    'approving a total that is not the current one is refused',
    `${refused.status} ${refused.code}`,
  );

  const bad = await refusal(
    tx.pay(checkout.id, { paymentToken: 'tok_decline', delivery }, randomUUID()),
  );
  assert(classifyPayError(bad).kind === 'declined', 'declined card classified');
  ok('a declined card on checkout', bad.code);
  const afterDecline = CheckoutSchema.parse(await tx.getCheckout(checkout.id));
  assert(
    afterDecline.state === 'Ready to Pay',
    `checkout still payable after a decline (${afterDecline.state})`,
  );

  const payRes = PayResponseSchema.parse(
    await tx.pay(checkout.id, { paymentToken: 'tok_ok', delivery }, randomUUID()),
  );
  assert(payRes.status === 'paid', `pay ${payRes.status}`);
  assert(
    payRes.paid === checkout.payable && payRes.depositCredit === checkout.depositCredit,
    'charged exactly the payable',
  );
  ok('paid with a new card (a new intent)', `order ${payRes.orderId}, charged ${payRes.paid} fils`);

  const after = CheckoutSchema.parse(await tx.getCheckout(checkout.id));
  assert(
    after.state === 'Paid' && after.orderId === payRes.orderId,
    'checkout is Paid with its order',
  );

  // 6. One order, grouped status.
  const order = BuyerOrderSchema.parse(await tx.getOrder(payRes.orderId));
  assert(order.lines.length === composition.items.length, 'a line per product');
  assert(
    !/commission|partner|seller/i.test(JSON.stringify(order).replace(/"openIssues"/g, '')),
    'no seller split in the buyer’s order',
  );
  const page = await tx.listOrders();
  assert(
    page.items.some((o) => o.id === order.id),
    'the order is listed',
  );
  ok('one order, one status per item', order.lines.map((l) => l.state).join(', '));

  // 7. Fulfilment (sellers), then the buyer's part.
  const lines = await harness.admin
    .selectFrom('fulfilment.order_line')
    .select(['id', 'partner_id'])
    .where('master_order_id', '=', order.id)
    .execute();
  for (const l of lines) {
    const actor = await sellerFor(l.partner_id);
    for (const to of ['Preparing', 'Ready for Dispatch', 'Dispatched'])
      await sellerCall(actor, 'POST', `/v1/seller/order-lines/${l.id}/advance`, { to });
    await sellerCall(actor, 'POST', `/v1/seller/order-lines/${l.id}/advance`, {
      to: 'Delivered',
      proofPhotoKey: `proof/${l.id}.jpg`,
    });
  }
  const delivered = BuyerOrderSchema.parse(await tx.getOrder(order.id));
  assert(
    delivered.lines.every((l) => l.state === 'Delivered'),
    'every line delivered',
  );

  const [first, ...rest] = delivered.lines;
  const issue = await tx.raiseIssue(order.id, first!.id, {
    flag: 'Damaged',
    note: 'A leg is cracked.',
  });
  assert(typeof issue.id === 'string', 'issue id returned');
  const withIssue = BuyerOrderSchema.parse(await tx.getOrder(order.id));
  const open = withIssue.lines.find((l) => l.id === first!.id)!.openIssues;
  assert(
    open.length === 1 && open[0]!.id === issue.id && open[0]!.flag === 'Damaged',
    'the open issue shows on the line',
  );
  assert(
    withIssue.status === 'Issue Reported',
    `order status ${withIssue.status} with an open issue`,
  );
  ok(
    'issue reported on one item',
    `${open[0]!.flag}, ${open[0]!.state}; order ${withIssue.status}`,
  );

  for (const l of rest) await tx.confirmReceipt(order.id, l.id);
  const partial = BuyerOrderSchema.parse(await tx.getOrder(order.id));
  assert(
    rest.every((l) => partial.lines.find((x) => x.id === l.id)!.state === 'Receipt Confirmed'),
    'receipt confirmed on the other items',
  );
  ok('receipt confirmed per item', `${rest.length} item(s)`);

  // 8. A flaky payment provider: the timeout happens AFTER the provider acted. One tap, one charge.
  await harness.admin
    .updateTable('catalogue.seller_offer')
    .set({ availability: 'In Stock', stock_qty: 50 })
    .where('id', 'in', offerIds)
    .execute();
  const second = CheckoutSchema.parse(
    await tx.startCheckout(
      { source: { kind: 'composition', compositionId: composition.id } },
      randomUUID(),
    ),
  );
  assert(second.state === 'Ready to Pay', `second checkout ${second.state}`);
  const authBefore = harness.gateway.calls.filter((c) => c.op === 'authorize').length;
  const capBefore = harness.gateway.calls.filter((c) => c.op === 'capture').length;
  payKeys.length = 0;
  const flaky = PayResponseSchema.parse(
    await withIntent(
      () => randomUUID(),
      (key) => tx.pay(second.id, { paymentToken: 'tok_flaky_once', delivery }, key),
      { attempts: 6, baseDelayMs: 20 },
    ),
  );
  assert(flaky.status === 'paid', 'the flaky payment completed');
  const authCalls = harness.gateway.calls.filter((c) => c.op === 'authorize').length - authBefore;
  const capCalls = harness.gateway.calls.filter((c) => c.op === 'capture').length - capBefore;
  assert(
    payKeys.length >= 2,
    `the first attempt must have failed and been retried (${payKeys.length} request(s))`,
  );
  assert(
    new Set(payKeys).size === 1,
    `every retry carried the same idempotency key (${new Set(payKeys).size} distinct)`,
  );
  assert(
    authCalls === 1 && capCalls === 1,
    `exactly one authorise and one capture (got ${authCalls}/${capCalls})`,
  );
  const payments = await harness.admin
    .selectFrom('commerce.payment')
    .select('id')
    .where('purchase_request_id', '=', second.id)
    .execute();
  const orders = await harness.admin
    .selectFrom('commerce.master_order')
    .select('id')
    .where('purchase_request_id', '=', second.id)
    .execute();
  assert(
    payments.length === 1 && orders.length === 1,
    `one payment (${payments.length}) and one order (${orders.length})`,
  );
  ok(
    'flaky provider: retried with the identical key',
    `${payKeys.length} requests, 1 authorise, 1 capture, 1 payment, 1 order`,
  );

  // 9. The account.
  const me = MeSchema.parse(await tx.me());
  assert(me.kind === 'buyer' && me.customer?.phone === PHONE, 'me');
  const renamed = CustomerSchema.parse(await tx.patchMe({ fullName: 'Amal H.' }));
  assert(renamed.fullName === 'Amal H.', 'profile updated');
  const arabic = CustomerSchema.parse(await tx.patchMe({ locale: 'ar' }));
  assert(arabic.locale === 'ar', 'language kept on the server');
  const created = AddressSchema.parse(
    await tx.createAddress({ ...delivery, label: 'Home', isDefault: true } as never),
  );
  const updated = AddressSchema.parse(
    await tx.updateAddress(created.id, { ...delivery, label: 'Villa', isDefault: true } as never),
  );
  assert(updated.label === 'Villa', 'address updated');
  assert((await tx.listAddresses()).length === 1, 'one address');
  await tx.deleteAddress(created.id);
  assert((await tx.listAddresses()).length === 0, 'address deleted');
  await tx.grantConsent('marketing', POLICY_VERSION);
  await tx.registerDevice({
    platform: 'ios',
    pushToken: 'device-push-token-12345',
    appVersion: '0.0.0',
  });
  const exported = DataExportSchema.parse(await tx.exportData());
  assert(
    exported.consents.some((c) => c.purpose === 'marketing' && !c.withdrawnAt),
    'consent recorded',
  );
  assert(exported.devices.length === 1, 'device registered');
  await tx.withdrawConsent('marketing');
  await tx.removeDevice('device-push-token-12345');
  const exported2 = DataExportSchema.parse(await tx.exportData());
  assert(
    exported2.consents.find((c) => c.purpose === 'marketing')?.withdrawnAt,
    'consent withdrawn',
  );
  assert(exported2.devices.length === 0, 'device removed');
  ok('account: profile, addresses, consent, push token, export');

  const erased = await tx.erase();
  assert(erased.status === 'erased', 'erased');
  const gone = await refusal(tx.me());
  assert(gone.status === 401, `the erased account's session is dead (${gone.status} ${gone.code})`);
  ok('account erased', `its session is refused afterwards (${gone.status} ${gone.code})`);

  console.log(`\nCOMMERCE SMOKE PASSED (${step} steps)`);
} catch (e) {
  failed = true;
  console.error('\nCOMMERCE SMOKE FAILED:', e instanceof Error ? (e.stack ?? e.message) : e);
} finally {
  await harness.close();
}
process.exit(failed ? 1 : 0);
