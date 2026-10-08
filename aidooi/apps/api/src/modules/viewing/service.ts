import type { Viewing } from '@aidooi/contracts';
import {
  RuleViolation,
  buildStops,
  fils,
  instant,
  partnerLocationId,
  type PartnerLocationId,
} from '@aidooi/domain';
import { recordAudit } from '../../audit.ts';
import { runAsSystem, type AppContext, type Tx } from '../../context.ts';
import { HttpError, conflict, notFound } from '../../http/problem.ts';
import { loadSnapshot } from '../catalogue/snapshot.ts';
import { createRefund, processRefund } from './refunds.ts';
import { loadData, lockRequest, toView, type ViewingData } from './repo.ts';
import {
  Outbox,
  SELLER_SLA_HOURS,
  at,
  ensureDeposit,
  scheduleJob,
  setRequestState,
  type Actor,
} from './transitions.ts';

export interface BuyerRef {
  readonly customerId: string;
}

/** Ownership is checked on every read and write: buyers only ever see their own viewings. */
async function ownedData(trx: Tx, id: string, buyer: BuyerRef): Promise<ViewingData> {
  const data = await loadData(trx, id);
  if (data.request.customer_id !== buyer.customerId) throw notFound('Viewing');
  return data;
}

export async function listViewings(ctx: AppContext, buyer: BuyerRef): Promise<Viewing[]> {
  return runAsSystem(ctx, async (trx) => {
    const ids = await trx
      .selectFrom('viewing.viewing_request')
      .select('id')
      .where('customer_id', '=', buyer.customerId)
      .orderBy('created_at', 'desc')
      .execute();
    const out: Viewing[] = [];
    for (const { id } of ids) out.push(toView(ctx, await loadData(trx, id)));
    return out;
  });
}

export async function getViewing(ctx: AppContext, buyer: BuyerRef, id: string): Promise<Viewing> {
  return runAsSystem(ctx, async (trx) => toView(ctx, await ownedData(trx, id, buyer)));
}

/* ---------------- Create ---------------- */

export async function createViewing(
  ctx: AppContext,
  buyer: BuyerRef,
  input: { compositionId: string; itemSlotKeys?: readonly string[] | undefined },
  correlationId: string,
): Promise<Viewing> {
  const out = new Outbox();
  const view = await runAsSystem(
    ctx,
    async (trx) => {
      const comp = await trx
        .selectFrom('recommendation.composition as c')
        .innerJoin('recommendation.recommendation_run as r', 'r.id', 'c.run_id')
        .innerJoin('recommendation.project as p', 'p.id', 'r.project_id')
        .select(['c.id', 'c.created_at', 'r.project_id'])
        .where('c.id', '=', input.compositionId)
        .where('p.customer_id', '=', buyer.customerId)
        .executeTakeFirst();
      if (!comp) throw notFound('Composition');

      let items = await trx
        .selectFrom('recommendation.composition_item')
        .select(['slot_key', 'product_id', 'offer_id', 'quantity'])
        .where('composition_id', '=', comp.id)
        .orderBy('slot_key')
        .execute();
      if (input.itemSlotKeys) {
        const wanted = new Set(input.itemSlotKeys);
        const unknown = [...wanted].filter((k) => !items.some((i) => i.slot_key === k));
        if (unknown.length)
          throw new HttpError(
            422,
            'unknown_slot',
            'Some products are not part of this composition.',
            unknown.map((u) => ({ path: 'itemSlotKeys', message: u })),
          );
        items = items.filter((i) => wanted.has(i.slot_key));
      }
      if (items.length === 0)
        throw new RuleViolation('empty_viewing', 'A viewing needs at least one product.');

      const types = [
        ...new Set(
          (
            await trx
              .selectFrom('catalogue.product')
              .select('product_type')
              .where(
                'id',
                'in',
                items.map((i) => i.product_id),
              )
              .execute()
          ).map((p) => p.product_type),
        ),
      ];
      // Eligibility is the view's call (ADR-024): an offer that sold out since the recommendation is simply absent.
      const snapshot = await loadSnapshot(trx, types);
      const locations = new Map(
        (
          await trx
            .selectFrom('catalogue.seller_offer')
            .select(['id', 'partner_location_id'])
            .where(
              'id',
              'in',
              items.map((i) => i.offer_id),
            )
            .execute()
        ).map((o) => [o.id, o.partner_location_id]),
      );

      const problems: { path: string; message: string }[] = [];
      const picked = items.flatMap((i) => {
        const offer = snapshot.offers.find((o) => o.id === i.offer_id);
        const location = locations.get(i.offer_id);
        if (!offer || !location) {
          problems.push({ path: i.slot_key, message: 'no longer available' });
          return [];
        }
        if (offer.viewingStatus === 'Not Viewable') {
          problems.push({ path: i.slot_key, message: 'cannot be viewed in store' });
          return [];
        }
        return [{ offer, locationId: partnerLocationId(location), ref: { ...i, offer } }];
      });
      if (problems.length) {
        throw new HttpError(
          422,
          'viewing_items_unavailable',
          'Some products cannot be viewed.',
          problems,
        );
      }

      const stops = buildStops(picked, instant(ctx.clock.now()));
      const request = await trx
        .insertInto('viewing.viewing_request')
        .values({
          customer_id: buyer.customerId,
          project_id: comp.project_id,
          composition_id: comp.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await recordAudit(trx, {
        entityType: 'viewing_request',
        entityId: request.id,
        from: null,
        to: 'Draft',
        actor: 'system',
        data: { by: 'buyer' },
      });
      await trx
        .insertInto('viewing.attribution_event')
        .values([
          { viewing_request_id: request.id, stage: 'Recommended', at: comp.created_at },
          { viewing_request_id: request.id, stage: 'Requested' },
        ])
        .execute();

      const pendingTasks: { taskId: string; partnerId: string; stopId: string }[] = [];
      for (const stop of stops) {
        const first = stop.products[0]!.ref.offer;
        const stopRow = await trx
          .insertInto('viewing.viewing_stop')
          .values({
            viewing_request_id: request.id,
            partner_id: first.partnerId,
            partner_location_id: stop.locationId as PartnerLocationId,
            stop_no: stop.stopNo,
            confirmation_state: stop.needsSellerConfirmation ? 'Pending' : 'Confirmed',
            responded_at: stop.needsSellerConfirmation ? null : at(ctx),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('viewing.viewing_product')
          .values(
            stop.products.map((p) => ({
              stop_id: stopRow.id,
              partner_id: p.ref.offer.partnerId,
              offer_id: p.ref.offer.id,
              product_id: p.ref.product_id,
              quantity: p.ref.quantity,
              unit_price_fils: p.ref.offer.sellingPrice,
            })),
          )
          .execute();
        if (stop.needsSellerConfirmation) {
          const task = await trx
            .insertInto('commerce.confirmation_task')
            .values({
              task_type: 'viewing',
              partner_id: first.partnerId,
              viewing_stop_id: stopRow.id,
              due_at: at(ctx, SELLER_SLA_HOURS),
              channel: 'app',
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          pendingTasks.push({ taskId: task.id, partnerId: first.partnerId, stopId: stopRow.id });
        }
      }

      const fresh = await loadData(trx, request.id);
      if (pendingTasks.length === 0) {
        await ensureDeposit(trx, fresh, 'system');
        await setRequestState(trx, request, 'Awaiting Deposit', 'system');
      } else {
        await setRequestState(trx, request, 'Awaiting Seller Confirmation', 'system');
        for (const t of pendingTasks) {
          out.add({
            template: 'viewing.seller_confirmation_requested',
            to: { kind: 'partner', id: t.partnerId },
            data: { taskId: t.taskId, viewingId: request.id },
            dedupeKey: `viewing.task:${t.taskId}`,
          });
          await scheduleJob(
            trx,
            'viewing.escalate_confirmation',
            { taskId: t.taskId },
            at(ctx, SELLER_SLA_HOURS / 2),
            `viewing.escalate:${t.taskId}`,
          );
        }
        await scheduleJob(
          trx,
          'viewing.expire_unconfirmed',
          { viewingRequestId: request.id, phase: 'sla' },
          at(ctx, SELLER_SLA_HOURS),
          `viewing.expire:${request.id}:sla`,
        );
      }
      return toView(ctx, await loadData(trx, request.id));
    },
    correlationId,
  );
  await out.flush(ctx);
  return view;
}

/* ---------------- Buyer decisions ---------------- */

/** Go ahead without the stops a showroom declined. The deposit is re-quoted over what remains. */
export async function continueWithoutDeclined(
  ctx: AppContext,
  buyer: BuyerRef,
  id: string,
  correlationId: string,
): Promise<Viewing> {
  return runAsSystem(
    ctx,
    async (trx) => {
      await ownedData(trx, id, buyer);
      await lockRequest(trx, id);
      const data = await loadData(trx, id);
      if (data.request.state === 'Awaiting Deposit') return toView(ctx, data); // already continued: idempotent
      const declined = data.stops.some((s) => s.confirmation_state === 'Declined');
      if (
        data.request.state !== 'Awaiting Seller Confirmation' ||
        !declined ||
        data.stops.some((s) => s.confirmation_state === 'Pending') ||
        !data.stops.some((s) => s.confirmation_state === 'Confirmed')
      ) {
        throw conflict(
          'viewing_no_decision_pending',
          'There is nothing to continue: no showroom has declined, or some are still to answer.',
        );
      }
      await ensureDeposit(trx, data, 'system');
      await setRequestState(
        trx,
        data.request,
        'Awaiting Deposit',
        { kind: 'buyer', customerId: buyer.customerId, guestSessionId: null },
        {},
        'continued without declined stops',
      );
      return toView(ctx, await loadData(trx, id));
    },
    correlationId,
  );
}

const CANCELLABLE = new Set([
  'Draft',
  'Awaiting Seller Confirmation',
  'Awaiting Deposit',
  'Confirmed',
]);

/**
 * Cancel a viewing. A paid deposit is refunded in full. The request is cancelled first and the refund
 * recorded in the same transaction, so a pass can never scan after the cancel; the provider call
 * follows and is retried by a job if it fails.
 */
export async function cancelViewing(
  ctx: AppContext,
  buyer: BuyerRef,
  id: string,
  correlationId: string,
): Promise<Viewing> {
  const out = new Outbox();
  let refundId: string | null = null;
  const view = await runAsSystem(
    ctx,
    async (trx) => {
      await ownedData(trx, id, buyer);
      await lockRequest(trx, id);
      const data = await loadData(trx, id);
      if (data.request.state === 'Cancelled') return toView(ctx, data);
      if (!CANCELLABLE.has(data.request.state))
        throw conflict(
          'viewing_not_cancellable',
          `A ${data.request.state} viewing cannot be cancelled.`,
        );
      const actor: Actor = { kind: 'buyer', customerId: buyer.customerId, guestSessionId: null };
      await setRequestState(trx, data.request, 'Cancelled', actor, {}, 'cancelled by buyer');
      if (data.deposit?.state === 'Paid') {
        refundId = await createRefund(trx, ctx, {
          depositId: data.deposit.id,
          amount: fils(Number(data.deposit.amount_fils)),
          reason: 'viewing_cancelled',
        });
      }
      for (const s of data.stops.filter((s) => s.confirmation_state === 'Confirmed')) {
        out.add({
          template: 'viewing.cancelled_for_seller',
          to: { kind: 'partner', id: s.partner_id },
          data: { viewingId: id, stopId: s.id },
          dedupeKey: `viewing.cancel-seller:${s.id}`,
        });
      }
      return toView(ctx, await loadData(trx, id));
    },
    correlationId,
  );
  await out.flush(ctx);
  if (refundId) await processRefund(ctx, refundId).catch(() => undefined); // the job retries it
  return view;
}
