import type { Viewing, ViewingTask } from '@aidooi/contracts';
import { dispositionAfter, fils, instant } from '@aidooi/domain';
import { recordAudit } from '../../audit.ts';
import { runAsSystem, type AppContext, type Tx } from '../../context.ts';
import type { ApiActor } from '../../http/actor.ts';
import { HttpError, conflict, notFound } from '../../http/problem.ts';
import { postTransfer } from './ledger.ts';
import { hashPass, passSecret, verifyPass } from './qr.ts';
import { iso, loadData, lockRequest, type StopDetail, type ViewingData } from './repo.ts';
import {
  Outbox,
  addAttribution,
  at,
  evaluateRequest,
  scheduleJob,
  setDepositState,
  setRequestState,
} from './transitions.ts';

type Seller = Extract<ApiActor, { kind: 'seller' }>;

/** The stops of a request that this seller user may act on: their partner, and their showroom if they are tied to one. */
const mine = (d: ViewingData, s: Seller): StopDetail[] =>
  d.stops.filter(
    (st) =>
      st.partner_id === s.partnerId &&
      (s.locationId === null || st.partner_location_id === s.locationId),
  );

/* ---------------- Tasks ---------------- */

export async function listTasks(ctx: AppContext, seller: Seller): Promise<ViewingTask[]> {
  return runAsSystem(ctx, async (trx) => {
    const rows = await trx
      .selectFrom('commerce.confirmation_task as t')
      .innerJoin('viewing.viewing_stop as s', 's.id', 't.viewing_stop_id')
      .innerJoin('viewing.viewing_request as r', 'r.id', 's.viewing_request_id')
      .innerJoin('catalogue.partner_location as l', 'l.id', 's.partner_location_id')
      .select([
        't.id',
        't.due_at',
        't.response',
        's.id as stop_id',
        's.partner_location_id',
        'r.id as request_id',
        'l.name as location_name',
      ])
      .where('t.partner_id', '=', seller.partnerId)
      .where('t.task_type', '=', 'viewing')
      .where('t.response', 'is', null)
      .where('r.state', '=', 'Awaiting Seller Confirmation')
      .orderBy('t.due_at')
      .execute();
    const visible = rows.filter(
      (r) => seller.locationId === null || r.partner_location_id === seller.locationId,
    );
    const out: ViewingTask[] = [];
    for (const r of visible) {
      const products = await trx
        .selectFrom('viewing.viewing_product as vp')
        .innerJoin('catalogue.product as p', 'p.id', 'vp.product_id')
        .innerJoin('catalogue.seller_offer as o', 'o.id', 'vp.offer_id')
        .select([
          'vp.offer_id',
          'vp.product_id',
          'vp.quantity',
          'vp.unit_price_fils',
          'p.name',
          'o.viewing_status',
        ])
        .where('vp.stop_id', '=', r.stop_id)
        .execute();
      out.push({
        id: r.id,
        viewingRequestId: r.request_id,
        stopId: r.stop_id,
        dueAt: iso(r.due_at),
        response: r.response as ViewingTask['response'],
        locationName: r.location_name,
        products: products.map((p) => ({
          offerId: p.offer_id,
          productId: p.product_id,
          name: p.name,
          quantity: p.quantity,
          unitPrice: fils(Number(p.unit_price_fils)),
          onDisplay: p.viewing_status === 'On Display',
        })),
      });
    }
    return out;
  });
}

/**
 * A showroom answers a viewing request. A confirmation with `displayConfirmed` also refreshes the
 * 72-hour freshness of the display claim on those offers (ADR-033). A decline notifies the buyer at
 * once; what happens to the request next is decided by `evaluateRequest`.
 */
export async function respond(
  ctx: AppContext,
  seller: Seller,
  taskId: string,
  body: { response: 'Confirmed' | 'Declined'; displayConfirmed?: boolean | undefined },
  correlationId: string,
) {
  const out = new Outbox();
  const result = await runAsSystem(
    ctx,
    async (trx) => {
      const task = await trx
        .selectFrom('commerce.confirmation_task')
        .selectAll()
        .where('id', '=', taskId)
        .where('partner_id', '=', seller.partnerId)
        .where('task_type', '=', 'viewing')
        .executeTakeFirst();
      if (!task || !task.viewing_stop_id) throw notFound('Task');
      const stop = await trx
        .selectFrom('viewing.viewing_stop')
        .selectAll()
        .where('id', '=', task.viewing_stop_id)
        .executeTakeFirstOrThrow();
      if (seller.locationId !== null && stop.partner_location_id !== seller.locationId)
        throw notFound('Task');

      const request = await lockRequest(trx, stop.viewing_request_id);
      const current = await trx
        .selectFrom('commerce.confirmation_task')
        .select('response')
        .where('id', '=', taskId)
        .executeTakeFirstOrThrow();
      if (current.response) {
        if (current.response === body.response)
          return { response: body.response, viewingState: request.state as Viewing['state'] };
        throw conflict(
          'task_already_answered',
          `This request was already answered: ${current.response}.`,
        );
      }
      if (request.state !== 'Awaiting Seller Confirmation') {
        throw conflict(
          'viewing_not_awaiting_confirmation',
          'This viewing is no longer waiting for showrooms to answer.',
        );
      }

      const now = at(ctx);
      await trx
        .updateTable('commerce.confirmation_task')
        .set({
          response: body.response,
          responded_at: now,
          responded_by_seller_user_id: seller.sellerUserId,
        })
        .where('id', '=', taskId)
        .execute();
      await trx
        .updateTable('viewing.viewing_stop')
        .set({ confirmation_state: body.response, responded_at: now })
        .where('id', '=', stop.id)
        .execute();
      await recordAudit(trx, {
        entityType: 'viewing_stop',
        entityId: stop.id,
        from: 'Pending',
        to: body.response,
        actor: seller,
      });

      if (body.response === 'Confirmed' && body.displayConfirmed) {
        const offers = await trx
          .selectFrom('viewing.viewing_product')
          .select('offer_id')
          .where('stop_id', '=', stop.id)
          .execute();
        await trx
          .updateTable('catalogue.seller_offer')
          .set({ viewing_confirmed_at: now })
          .where(
            'id',
            'in',
            offers.map((o) => o.offer_id),
          )
          .where('viewing_status', '=', 'On Display')
          .execute();
      }
      if (body.response === 'Declined') {
        out.add({
          template: 'viewing.stop_declined',
          to: { kind: 'customer', id: request.customer_id },
          data: { viewingId: request.id, stopId: stop.id },
          dedupeKey: `viewing.stop-declined:${stop.id}`,
        });
      }
      await evaluateRequest(trx, ctx, request.id, out);
      const after = await trx
        .selectFrom('viewing.viewing_request')
        .select('state')
        .where('id', '=', request.id)
        .executeTakeFirstOrThrow();
      return { response: body.response, viewingState: after.state as Viewing['state'] };
    },
    correlationId,
  );
  await out.flush(ctx);
  return { taskId, ...result };
}

/* ---------------- Scan and outcome ---------------- */

const SCAN_ERRORS = {
  malformed: 'pass_invalid',
  signature: 'pass_invalid',
  expired: 'pass_expired',
  not_yet_valid: 'pass_not_yet_valid',
} as const;

/** Check a buyer in. Repeating the scan returns the same result and never changes the first check-in time. */
export async function scan(ctx: AppContext, seller: Seller, token: string, correlationId: string) {
  const check = verifyPass(passSecret(ctx.config), token, ctx.clock.now());
  if (!check.ok)
    throw new HttpError(422, SCAN_ERRORS[check.reason], 'This pass cannot be accepted.');

  return runAsSystem(
    ctx,
    async (trx) => {
      const head = await trx
        .selectFrom('viewing.viewing_request')
        .select(['id', 'qr_token_hash'])
        .where('id', '=', check.viewingId)
        .executeTakeFirst();
      // Same answer for "no such viewing" and "not your viewing": a showroom learns nothing about others' bookings.
      if (!head || head.qr_token_hash !== hashPass(token))
        throw new HttpError(422, 'pass_invalid', 'This pass cannot be accepted.');
      const request = await lockRequest(trx, head.id);
      const data = await loadData(trx, head.id);
      const own = mine(data, seller).filter((s) => s.confirmation_state === 'Confirmed');
      if (own.length === 0) throw notFound('Viewing');
      // The first showroom to report the buyer's visit completes the viewing, but the buyer is still
      // touring: later showrooms must be able to check them in. Only a dead viewing refuses a scan.
      if (request.state !== 'Confirmed' && request.state !== 'Completed') {
        throw conflict('viewing_not_active', `This viewing is ${request.state}.`);
      }
      const now = at(ctx);
      for (const s of own.filter((s) => !s.checked_in_at)) {
        await trx
          .updateTable('viewing.viewing_stop')
          .set({ checked_in_at: now })
          .where('id', '=', s.id)
          .execute();
        await recordAudit(trx, {
          entityType: 'viewing_stop',
          entityId: s.id,
          from: null,
          to: 'Checked in',
          actor: seller,
        });
      }
      const first = own[0] as StopDetail;
      const buyer = await trx
        .selectFrom('identity.customer')
        .select('full_name')
        .where('id', '=', request.customer_id)
        .executeTakeFirst();
      return {
        viewingRequestId: request.id,
        stopId: first.id,
        scheduledAt: iso(request.scheduled_at as Date),
        buyerName: buyer?.full_name ?? null,
        products: [...first.products],
        checkedInAt: iso(first.checked_in_at ?? now),
      };
    },
    correlationId,
  );
}

/**
 * The showroom records whether the buyer came. Outcome of the whole viewing follows from the stops:
 * attended anywhere → Completed (the buyer showed up); every confirmed stop reports a no-show →
 * No-show. See {@link resolveRequest}.
 */
export async function recordOutcome(
  ctx: AppContext,
  seller: Seller,
  viewingId: string,
  outcome: 'Completed' | 'No-show',
  correlationId: string,
) {
  const out = new Outbox();
  const attendance = outcome === 'Completed' ? 'Attended' : 'No-show';
  const res = await runAsSystem(
    ctx,
    async (trx) => {
      const request = await lockRequest(trx, viewingId);
      const data = await loadData(trx, viewingId);
      const own = mine(data, seller).filter((s) => s.confirmation_state === 'Confirmed');
      if (own.length === 0) throw notFound('Viewing');
      const closedButRecordable = request.state === 'Completed' && attendance === 'Attended';
      if (request.state !== 'Confirmed' && !closedButRecordable) {
        throw conflict(
          'viewing_closed',
          `This viewing is ${request.state}; its outcome can no longer be recorded.`,
        );
      }
      for (const s of own) {
        if (s.attendance === attendance) continue;
        if (s.attendance)
          throw conflict(
            'outcome_already_recorded',
            `This showroom already recorded: ${s.attendance}.`,
          );
        if (attendance === 'Attended' && !s.checked_in_at)
          throw conflict(
            'not_checked_in',
            'Scan the buyer’s pass before marking the visit completed.',
          );
        if (attendance === 'No-show' && s.checked_in_at)
          throw conflict(
            'already_checked_in',
            'The buyer has checked in; this cannot be a no-show.',
          );
        await trx
          .updateTable('viewing.viewing_stop')
          .set({ attendance, attendance_at: at(ctx) })
          .where('id', '=', s.id)
          .execute();
        await recordAudit(trx, {
          entityType: 'viewing_stop',
          entityId: s.id,
          from: null,
          to: attendance,
          actor: seller,
        });
      }
      await resolveRequest(trx, ctx, viewingId, out);
      const after = await trx
        .selectFrom('viewing.viewing_request')
        .select('state')
        .where('id', '=', viewingId)
        .executeTakeFirstOrThrow();
      return {
        stopAttendance: attendance as 'Attended' | 'No-show',
        viewingState: after.state as Viewing['state'],
      };
    },
    correlationId,
  );
  await out.flush(ctx);
  return res;
}

/**
 * Decide the viewing's outcome from its stops (caller holds the request lock):
 *  - any confirmed stop Attended         → Completed; the deposit is held for the credit window
 *  - every confirmed stop No-show        → No-show; the deposit is forfeited
 *  - otherwise some showrooms have yet to report; nothing happens
 */
export async function resolveRequest(
  trx: Tx,
  ctx: AppContext,
  requestId: string,
  out: Outbox,
): Promise<void> {
  const data = await loadData(trx, requestId);
  const r = data.request;
  if (r.state !== 'Confirmed') return;
  const confirmed = data.stops.filter((s) => s.confirmation_state === 'Confirmed');
  const now = at(ctx);

  if (confirmed.some((s) => s.attendance === 'Attended')) {
    await setRequestState(trx, r, 'Completed', 'system', { outcome_at: now });
    await addAttribution(trx, r.id, 'Viewed');
    const disposition = dispositionAfter('Completed', instant(ctx.clock.now()));
    if (disposition.kind === 'hold') {
      await scheduleJob(
        trx,
        'viewing.release_deposit',
        { viewingRequestId: r.id },
        new Date(disposition.until),
        `viewing.release:${r.id}`,
      );
    }
    out.add({
      template: 'viewing.completed',
      to: { kind: 'customer', id: r.customer_id },
      data: { viewingId: r.id },
      dedupeKey: `viewing.completed:${r.id}`,
    });
    return;
  }
  if (confirmed.every((s) => s.attendance === 'No-show')) await markNoShow(trx, ctx, data, out);
}

/** The buyer did not come: the deposit is non-refundable and becomes revenue. */
export async function markNoShow(
  trx: Tx,
  ctx: AppContext,
  data: ViewingData,
  out: Outbox,
): Promise<void> {
  const r = data.request;
  await setRequestState(trx, r, 'No-show', 'system', { outcome_at: at(ctx) });
  if (data.deposit?.state === 'Paid') {
    await setDepositState(trx, data.deposit, 'Non-refundable', 'system');
    await postTransfer(trx, ctx, {
      debit: 'deposits_held',
      credit: 'forfeited_deposits_revenue',
      amount: fils(Number(data.deposit.amount_fils)),
      refType: 'viewing_deposit',
      refId: data.deposit.id,
      memo: 'deposit forfeited after no-show',
    });
  }
  await addAttribution(trx, r.id, 'Not Purchased', 'no-show');
  out.add({
    template: 'viewing.no_show',
    to: { kind: 'customer', id: r.customer_id },
    data: { viewingId: r.id },
    dedupeKey: `viewing.no-show:${r.id}`,
  });
}
