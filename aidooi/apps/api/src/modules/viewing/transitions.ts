import { enqueue } from '@aidooi/db';
import { assertTransition, viewingRequest, viewingDeposit, type Fils } from '@aidooi/domain';
import { recordAudit } from '../../audit.ts';
import type { AppContext, Tx } from '../../context.ts';
import type { ApiActor } from '../../http/actor.ts';
import type { Notification } from '../../ports.ts';
import { loadData, quoteFor, type DepositRow, type RequestRow, type ViewingData } from './repo.ts';

export type Actor = ApiActor | 'system';

/** Notifications collected inside a transaction and sent only after it commits. */
export class Outbox {
  readonly items: Notification[] = [];
  add(n: Notification): void {
    this.items.push(n);
  }
  async flush(ctx: AppContext): Promise<void> {
    for (const n of this.items) {
      // A channel outage must never undo or fail a business action that already committed.
      await ctx.notifier.send(n).catch(() => undefined);
    }
  }
}

export const SELLER_SLA_HOURS = 12;
/** After a showroom declines, the buyer has this long to decide before the request lapses. */
export const DECISION_WINDOW_HOURS = 24;

export const at = (ctx: AppContext, plusHours = 0): Date =>
  new Date(ctx.clock.now() + plusHours * 3_600_000);

export async function setRequestState(
  trx: Tx,
  r: RequestRow,
  to: RequestRow['state'],
  actor: Actor,
  extra: { outcome_at?: Date; scheduled_at?: Date; qr_token_hash?: string } = {},
  reason?: string,
): Promise<void> {
  assertTransition(viewingRequest, r.state as never, to as never);
  await trx
    .updateTable('viewing.viewing_request')
    .set({ state: to, ...extra })
    .where('id', '=', r.id)
    .execute();
  await recordAudit(trx, {
    entityType: 'viewing_request',
    entityId: r.id,
    from: r.state,
    to,
    actor,
    ...(reason ? { reason } : {}),
  });
}

export async function setDepositState(
  trx: Tx,
  d: DepositRow,
  to: DepositRow['state'],
  actor: Actor,
  extra: { credited_fils?: number } = {},
): Promise<void> {
  assertTransition(viewingDeposit, d.state as never, to as never);
  await trx
    .updateTable('viewing.viewing_deposit')
    .set({ state: to, ...extra })
    .where('id', '=', d.id)
    .execute();
  await recordAudit(trx, {
    entityType: 'viewing_deposit',
    entityId: d.id,
    from: d.state,
    to,
    actor,
  });
}

export async function addAttribution(
  trx: Tx,
  requestId: string,
  stage: string,
  note?: string,
): Promise<void> {
  await trx
    .insertInto('viewing.attribution_event')
    .values({ viewing_request_id: requestId, stage, note: note ?? null })
    .execute();
}

/**
 * The deposit is quoted over the stops that will actually be visited and stored only when the
 * request reaches Awaiting Deposit, because a stored deposit is immutable (the database refuses to
 * change its basis) and a declined stop would otherwise leave it wrong.
 */
export async function ensureDeposit(trx: Tx, data: ViewingData, actor: Actor): Promise<DepositRow> {
  if (data.deposit) return data.deposit;
  const q = quoteFor(data.stops);
  const row = await trx
    .insertInto('viewing.viewing_deposit')
    .values({
      viewing_request_id: data.request.id,
      basis_fils: q.base,
      amount_fils: q.amount,
      capped: q.capped,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await recordAudit(trx, {
    entityType: 'viewing_deposit',
    entityId: row.id,
    from: null,
    to: 'Pending',
    actor,
    data: { amountFils: q.amount as Fils },
  });
  return row;
}

export const scheduleJob = (
  trx: Tx,
  kind: string,
  payload: object,
  runAt: Date,
  dedupeKey: string,
) => enqueue(trx, kind, payload, { runAt, dedupeKey });

/**
 * Called whenever a stop is answered or lapses. Decides what the request does next:
 *  - every stop confirmed        → Awaiting Deposit
 *  - every stop declined         → Cancelled
 *  - mixed                       → stays put; the buyer decides to continue without the declined
 *                                  stops or to cancel, and has {@link DECISION_WINDOW_HOURS} to do so
 */
export async function evaluateRequest(
  trx: Tx,
  ctx: AppContext,
  requestId: string,
  out: Outbox,
): Promise<void> {
  const data = await loadData(trx, requestId);
  const r = data.request;
  if (r.state !== 'Awaiting Seller Confirmation') return;
  if (data.stops.some((s) => s.confirmation_state === 'Pending')) return;

  const confirmed = data.stops.filter((s) => s.confirmation_state === 'Confirmed').length;
  const declined = data.stops.length - confirmed;
  const to = r.customer_id;

  if (confirmed === 0) {
    await setRequestState(trx, r, 'Cancelled', 'system', {}, 'all stops declined');
    out.add({
      template: 'viewing.cancelled',
      to: { kind: 'customer', id: to },
      data: { viewingId: r.id, reason: 'all_declined' },
      dedupeKey: `viewing.cancelled:${r.id}`,
    });
    return;
  }
  if (declined === 0) {
    await ensureDeposit(trx, data, 'system');
    await setRequestState(trx, r, 'Awaiting Deposit', 'system');
    out.add({
      template: 'viewing.ready_for_deposit',
      to: { kind: 'customer', id: to },
      data: { viewingId: r.id },
      dedupeKey: `viewing.ready:${r.id}`,
    });
    return;
  }
  await scheduleJob(
    trx,
    'viewing.expire_unconfirmed',
    { viewingRequestId: r.id, phase: 'decision' },
    at(ctx, DECISION_WINDOW_HOURS),
    `viewing.expire:${r.id}:decision`,
  );
  out.add({
    template: 'viewing.decision_needed',
    to: { kind: 'customer', id: to },
    data: { viewingId: r.id, declinedStops: declined },
    dedupeKey: `viewing.decision:${r.id}`,
  });
}
