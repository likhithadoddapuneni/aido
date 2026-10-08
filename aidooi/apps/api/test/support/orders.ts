import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { fixtures } from '@aidooi/db/testing';
import {
  aed,
  bps,
  offerId,
  partnerId as brandPartner,
  productId,
  splitOrder,
  fils,
  type Bps,
  type Fils,
} from '@aidooi/domain';
import type { Harness } from './harness.ts';

export interface LineSpec {
  /** Seed partner code, e.g. 'PRT-001'. */
  readonly partner: string;
  readonly quantity?: number;
  /** Override the offer's price (fils) to make hand-computed examples round. */
  readonly unitPriceFils?: number;
  readonly commissionBps?: number;
}

export interface OrderSpec {
  readonly customerId?: string;
  readonly lines: readonly LineSpec[];
  /** Mock-gateway behaviour for the order's capture payment (see TEST_TOKENS). */
  readonly paymentToken?: string;
  /** Deposit credit to apply; creates a real viewing, deposit and deposit payment. */
  readonly depositCreditFils?: number;
}

export interface CreatedOrder {
  readonly customerId: string;
  readonly orderId: string;
  readonly lineIds: readonly string[];
  readonly partnerIds: readonly string[];
  readonly grossFils: Fils;
  readonly paidFils: Fils;
  readonly depositCreditFils: Fils;
  readonly capturePaymentId: string | null;
  readonly depositPaymentId: string | null;
}

let pick = 0;

/** One payment through the mock gateway and the real payment state machine. */
async function pay(
  h: Harness,
  v: { customerId: string; amount: Fils; token?: string } & (
    | { purpose: 'Order'; purchaseRequestId: string }
    | { purpose: 'ViewingDeposit'; depositId: string }
  ),
): Promise<{ paymentId: string; providerRef: string }> {
  const key = `test-${randomUUID()}`;
  // A flaky token throws once AFTER the provider acted; retrying with the same key is what the saga does.
  const retry = async <T>(f: () => Promise<T>): Promise<T> => f().catch(() => f());
  const auth = await retry(() =>
    h.gateway.authorize({
      idempotencyKey: key,
      amount: v.amount,
      paymentToken: v.token ?? 'tok_ok',
      reference: key,
    }),
  );
  if (auth.status !== 'authorized') throw new Error('mock authorisation failed');
  await retry(() =>
    h.gateway.capture({
      idempotencyKey: `cap-${key}`,
      providerRef: auth.providerRef,
      amount: v.amount,
    }),
  );
  const { id } = await h.admin
    .insertInto('commerce.payment')
    .values({
      purpose: v.purpose,
      customer_id: v.customerId,
      ...(v.purpose === 'Order'
        ? { purchase_request_id: v.purchaseRequestId }
        : { viewing_deposit_id: v.depositId }),
      state: 'Pending',
      provider: 'mock',
      provider_ref: auth.providerRef,
      amount_fils: v.amount,
      idempotency_key: key,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await h.admin
    .updateTable('commerce.payment')
    .set({ state: 'Authorized', authorized_at: new Date() })
    .where('id', '=', id)
    .execute();
  await h.admin
    .updateTable('commerce.payment')
    .set({ state: 'Successful', captured_at: new Date() })
    .where('id', '=', id)
    .execute();
  return { paymentId: id, providerRef: auth.providerRef };
}

export async function ledger(
  h: Harness,
  entries: readonly { account: string; direction: 'debit' | 'credit'; amount: Fils }[],
  refType: string,
  refId: string,
) {
  const group = randomUUID();
  await h.admin
    .insertInto('commerce.ledger_entry')
    .values(
      entries.map((e) => ({
        entry_group: group,
        account: e.account,
        direction: e.direction,
        amount_fils: e.amount,
        ref_type: refType,
        ref_id: refId,
      })),
    )
    .execute();
}

/** Build a fully paid order — every row through the same constraints and triggers production uses. */
export async function createOrder(h: Harness, spec: OrderSpec): Promise<CreatedOrder> {
  const seeded = h.seeded;
  if (!seeded) throw new Error('createOrder needs a seeded harness');
  const customerId = spec.customerId ?? (await fixtures.customer(h.admin));

  const priced = [];
  for (const [i, l] of spec.lines.entries()) {
    const partnerUuid = seeded.partners.get(l.partner);
    if (!partnerUuid) throw new Error(`Unknown seed partner ${l.partner}`);
    const row = await h.admin
      .selectFrom('catalogue.seller_offer as o')
      .innerJoin('catalogue.product as p', 'p.id', 'o.product_id')
      .select(['o.id', 'o.product_id', 'o.selling_price_fils', 'o.delivery_days', 'p.name'])
      .where('o.partner_id', '=', partnerUuid)
      .where('o.stock_qty', '>', 0)
      .orderBy('o.id')
      .limit(1)
      .offset(pick++ + i)
      .executeTakeFirstOrThrow();
    priced.push({
      line: l,
      partnerUuid,
      row,
      priced: {
        productId: productId(row.product_id),
        offerId: offerId(row.id),
        partnerId: brandPartner(partnerUuid),
        productName: row.name,
        quantity: l.quantity ?? 1,
        unitPrice: fils(l.unitPriceFils ?? row.selling_price_fils),
        commissionRate: (l.commissionBps !== undefined ? bps(l.commissionBps) : bps(1400)) as Bps,
      },
    });
  }

  const requestedCredit = fils(spec.depositCreditFils ?? 0);
  const draft = splitOrder(
    priced.map((p) => p.priced),
    requestedCredit,
  );

  let viewingId: string | null = null;
  let depositPaymentId: string | null = null;
  if (draft.depositCredit > 0) {
    const project = await fixtures.project(h.admin, customerId);
    const v = await h.admin
      .insertInto('viewing.viewing_request')
      .values({ customer_id: customerId, project_id: project })
      .returning('id')
      .executeTakeFirstOrThrow();
    viewingId = v.id;
    const setViewing = (state: string, extra: Record<string, unknown> = {}) =>
      h.admin
        .updateTable('viewing.viewing_request')
        .set({ state, ...extra })
        .where('id', '=', v.id)
        .execute();
    await setViewing('Awaiting Deposit');
    await setViewing('Confirmed', {
      qr_token_hash: `qr-${randomUUID()}`,
      scheduled_at: new Date(),
    });
    await setViewing('Completed');
    // Basis AED 10,000 → 5% = AED 500, the cap.
    const dep = await h.admin
      .insertInto('viewing.viewing_deposit')
      .values({
        viewing_request_id: v.id,
        basis_fils: aed(10_000),
        amount_fils: aed(500),
        capped: false,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const depPay = await pay(h, {
      customerId,
      amount: aed(500),
      purpose: 'ViewingDeposit',
      depositId: dep.id,
    });
    depositPaymentId = depPay.paymentId;
    await h.admin
      .updateTable('viewing.viewing_deposit')
      .set({ state: 'Paid' })
      .where('id', '=', dep.id)
      .execute();
    await h.admin
      .updateTable('viewing.viewing_deposit')
      .set({ state: 'Credited' })
      .where('id', '=', dep.id)
      .execute();
    await ledger(
      h,
      [
        { account: 'psp_clearing', direction: 'debit', amount: aed(500) },
        { account: 'deposits_held', direction: 'credit', amount: aed(500) },
      ],
      'viewing_deposit',
      dep.id,
    );
  }
  const credit = draft.depositCredit;

  const pr = await h.admin
    .insertInto('commerce.purchase_request')
    .values({ customer_id: customerId, total_fils: draft.gross, validation_state: 'Validated' })
    .returning('id')
    .executeTakeFirstOrThrow();
  for (const p of priced) {
    await h.admin
      .insertInto('commerce.purchase_request_line')
      .values({
        purchase_request_id: pr.id,
        offer_id: p.row.id,
        quantity: p.priced.quantity,
        quoted_unit_price_fils: p.priced.unitPrice,
      })
      .execute();
  }
  const capture =
    draft.payable > 0
      ? await pay(h, {
          customerId,
          amount: draft.payable,
          purpose: 'Order',
          purchaseRequestId: pr.id,
          ...(spec.paymentToken ? { token: spec.paymentToken } : {}),
        })
      : null;

  const master = await h.admin
    .insertInto('commerce.master_order')
    .values({
      customer_id: customerId,
      payment_id: capture?.paymentId ?? null,
      purchase_request_id: pr.id,
      viewing_request_id: viewingId,
      gross_fils: draft.gross,
      deposit_credit_fils: credit,
      paid_fils: draft.payable,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  await ledger(
    h,
    [
      { account: 'psp_clearing', direction: 'debit' as const, amount: draft.payable },
      { account: 'deposits_held', direction: 'debit' as const, amount: credit },
      { account: 'sales_collected', direction: 'credit' as const, amount: draft.gross },
    ].filter((e) => e.amount > 0),
    'master_order',
    master.id,
  );

  await h.admin
    .insertInto('commerce.order_delivery')
    .values({
      master_order_id: master.id,
      customer_id: customerId,
      recipient_name: 'Test Buyer',
      phone_e164: '+971501234567',
      line1: 'Marina Walk 1',
      emirate: 'Dubai',
      instructions: 'Call on arrival',
    })
    .execute();

  const lineIds: string[] = [];
  const partnerIds: string[] = [];
  for (const so of draft.sellerOrders) {
    const partnerUuid = so.partnerId as unknown as string;
    partnerIds.push(partnerUuid);
    const sellerOrder = await h.admin
      .insertInto('commerce.seller_order')
      .values({
        master_order_id: master.id,
        partner_id: partnerUuid,
        customer_id: customerId,
        subtotal_fils: so.gross,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const l of so.lines) {
      const s = l.snapshot;
      const src = priced.find((p) => p.priced.offerId === s.offerId) as (typeof priced)[number];
      const id = randomUUID();
      await h.admin
        .insertInto('fulfilment.order_line')
        .values({
          id,
          master_order_id: master.id,
          seller_order_id: sellerOrder.id,
          partner_id: partnerUuid,
          customer_id: customerId,
          product_id: s.productId,
          offer_id: s.offerId,
          quantity: s.quantity,
          unit_price_fils: s.unitPrice,
          gross_line_fils: s.grossLine,
          commission_rate: s.commissionRate / 10_000,
          commission_fils: s.commission,
          snapshot: JSON.stringify({
            productId: s.productId,
            offerId: s.offerId,
            quantity: s.quantity,
            unitPriceFils: s.unitPrice,
            productName: s.productName,
            deliveryDays: src.row.delivery_days,
          }),
        })
        .execute();
      lineIds.push(id);
    }
  }
  return {
    customerId,
    orderId: master.id,
    lineIds,
    partnerIds,
    grossFils: draft.gross,
    paidFils: draft.payable,
    depositCreditFils: credit,
    capturePaymentId: capture?.paymentId ?? null,
    depositPaymentId,
  };
}

/** Net of every posting to an account (debits − credits), in fils. */
export async function balance(h: Harness, account: string): Promise<number> {
  const r = await h.admin
    .selectFrom('commerce.ledger_entry')
    .select(
      sql<string>`coalesce(sum(CASE direction WHEN 'debit' THEN amount_fils ELSE -amount_fils END), 0)`.as(
        'b',
      ),
    )
    .where('account', '=', account)
    .executeTakeFirstOrThrow();
  return Number(r.b);
}

export async function lineRow(h: Harness, id: string) {
  return h.admin
    .selectFrom('fulfilment.order_line')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
}

/** Walk a line to Delivered through the real API as its seller. */
export async function deliver(
  h: Harness,
  sellerActor: Parameters<Harness['as']>[0],
  lineId: string,
): Promise<void> {
  for (const to of ['Preparing', 'Ready for Dispatch', 'Dispatched'] as const) {
    const r = await h.app.inject({
      method: 'POST',
      url: `/v1/seller/order-lines/${lineId}/advance`,
      headers: h.as(sellerActor),
      payload: { to },
    });
    if (r.statusCode !== 200) throw new Error(`advance ${to}: ${r.body}`);
  }
  const r = await h.app.inject({
    method: 'POST',
    url: `/v1/seller/order-lines/${lineId}/advance`,
    headers: h.as(sellerActor),
    payload: { to: 'Delivered', proofPhotoKey: 'proof/abc123.jpg' },
  });
  if (r.statusCode !== 200) throw new Error(`advance Delivered: ${r.body}`);
}

/**
 * Put lines straight into Receipt Confirmed / Eligible through the real state machine (no HTTP), at
 * `at`. For settlement scenarios that need many confirmed lines without hundreds of requests.
 */
export async function confirmDirect(h: Harness, lineId: string, at: Date): Promise<void> {
  for (const state of ['Preparing', 'Ready for Dispatch', 'Dispatched']) {
    await h.admin
      .updateTable('fulfilment.order_line')
      .set({ state })
      .where('id', '=', lineId)
      .execute();
  }
  await h.admin
    .updateTable('fulfilment.order_line')
    .set({ state: 'Delivered', delivered_at: at })
    .where('id', '=', lineId)
    .execute();
  await h.admin
    .updateTable('fulfilment.order_line')
    .set({ state: 'Receipt Confirmed', receipt_confirmed_at: at, settlement_state: 'Eligible' })
    .where('id', '=', lineId)
    .execute();
}

export async function ledgerNetAll(h: Harness): Promise<number> {
  const r = await h.admin
    .selectFrom('commerce.ledger_entry')
    .select(
      sql<string>`coalesce(sum(CASE direction WHEN 'debit' THEN amount_fils ELSE -amount_fils END), 0)`.as(
        'b',
      ),
    )
    .executeTakeFirstOrThrow();
  return Number(r.b);
}
