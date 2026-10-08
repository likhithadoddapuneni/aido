import {
  RuleViolation,
  advance,
  type Fils,
  type Instant,
  type LineFacts,
  type OrderLineState,
  type SettlementState,
} from '@aidooi/domain';
import { recordAudit } from '../../audit.ts';
import type { AppContext, Tx } from '../../context.ts';
import type { ApiActor } from '../../http/actor.ts';
import { conflict, notFound } from '../../http/problem.ts';
import { createRefundsForLine } from './refunds.ts';

export interface LineRow {
  readonly id: string;
  readonly masterOrderId: string;
  readonly partnerId: string;
  readonly customerId: string;
  readonly productId: string;
  readonly grossLine: Fils;
  readonly state: OrderLineState;
  readonly settlement: SettlementState;
  readonly deliveredAt: Date | null;
  readonly receiptConfirmedAt: Date | null;
}

export interface Ownership {
  readonly partnerId?: string;
  readonly customerId?: string;
  readonly masterOrderId?: string;
}

/**
 * Lock one order line, restricted to its owner. The platform performs the mutation (RLS lets only
 * the platform create and settle), so ownership is checked here explicitly: a line that is not the
 * caller's is indistinguishable from one that does not exist.
 */
export async function lockLine(
  trx: Tx,
  id: string,
  owner: Ownership,
  opts: { skipLocked?: boolean } = {},
): Promise<LineRow | null> {
  let q = trx
    .selectFrom('fulfilment.order_line')
    .select([
      'id',
      'master_order_id',
      'partner_id',
      'customer_id',
      'product_id',
      'gross_line_fils',
      'state',
      'settlement_state',
      'delivered_at',
      'receipt_confirmed_at',
    ])
    .where('id', '=', id);
  if (owner.partnerId) q = q.where('partner_id', '=', owner.partnerId);
  if (owner.customerId) q = q.where('customer_id', '=', owner.customerId);
  if (owner.masterOrderId) q = q.where('master_order_id', '=', owner.masterOrderId);
  q = q.forUpdate();
  if (opts.skipLocked) q = q.skipLocked();
  const r = await q.executeTakeFirst();
  if (!r) return null;
  return {
    id: r.id,
    masterOrderId: r.master_order_id,
    partnerId: r.partner_id,
    customerId: r.customer_id,
    productId: r.product_id,
    grossLine: r.gross_line_fils as Fils,
    state: r.state as OrderLineState,
    settlement: r.settlement_state as SettlementState,
    deliveredAt: r.delivered_at ? new Date(r.delivered_at) : null,
    receiptConfirmedAt: r.receipt_confirmed_at ? new Date(r.receipt_confirmed_at) : null,
  };
}

export async function requireLine(trx: Tx, id: string, owner: Ownership): Promise<LineRow> {
  const line = await lockLine(trx, id, owner);
  if (!line) throw notFound('Order line');
  return line;
}

export async function openIssueCount(trx: Tx, lineId: string): Promise<number> {
  const r = await trx
    .selectFrom('fulfilment.issue')
    .select((e) => e.fn.countAll<string>().as('n'))
    .where('order_line_id', '=', lineId)
    .where('state', 'in', ['Open', 'Partner Handling'])
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

export const factsOf = (row: LineRow, openIssues: number): LineFacts => ({
  state: row.state,
  settlement: row.settlement,
  deliveredAt: row.deliveredAt ? (row.deliveredAt.getTime() as Instant) : null,
  openIssues,
});

/** Write back what the domain decided. Money, snapshot and ownership columns are write-once in the database. */
export async function persistFacts(
  trx: Tx,
  row: LineRow,
  facts: LineFacts,
  at: Instant,
): Promise<void> {
  const receipt =
    facts.state === 'Receipt Confirmed' && !row.receiptConfirmedAt ? new Date(at) : undefined;
  await trx
    .updateTable('fulfilment.order_line')
    .set({
      state: facts.state,
      settlement_state: facts.settlement,
      // Only write delivered_at when it changed: the database keeps microseconds that a JS Date would trim.
      ...(facts.deliveredAt !== (row.deliveredAt?.getTime() ?? null)
        ? { delivered_at: facts.deliveredAt === null ? null : new Date(facts.deliveredAt) }
        : {}),
      ...(receipt ? { receipt_confirmed_at: receipt } : {}),
    })
    .where('id', '=', row.id)
    .execute();
}

export interface TransitionResult {
  readonly changed: boolean;
  readonly line: LineRow;
  readonly state: OrderLineState;
  /** Refund rows created in this transaction; execute them after commit. */
  readonly refundIds: readonly string[];
}

/**
 * Move a line one step. Same-state requests are no-ops, so a client retry after a lost response is
 * harmless. Cancelling a paid line refunds it, in the same transaction as the state change.
 */
export async function transitionLine(
  ctx: AppContext,
  trx: Tx,
  args: {
    readonly lineId: string;
    readonly owner: Ownership;
    readonly to: OrderLineState;
    readonly actor: ApiActor | 'system';
    readonly reason?: string | undefined;
    readonly data?: Record<string, unknown>;
  },
): Promise<TransitionResult> {
  const line = await requireLine(trx, args.lineId, args.owner);
  if (line.state === args.to) return { changed: false, line, state: line.state, refundIds: [] };

  const now = ctx.clock.now();
  const facts = factsOf(line, await openIssueCount(trx, line.id));
  const next = advance(facts, args.to, now); // throws RuleViolation: illegal transition / open issue
  await persistFacts(trx, line, next, now);
  await recordAudit(trx, {
    entityType: 'order_line',
    entityId: line.id,
    from: line.state,
    to: next.state,
    actor: args.actor,
    ...(args.reason ? { reason: args.reason } : {}),
    ...(args.data ? { data: args.data } : {}),
  });

  const refundIds =
    args.to === 'Cancelled'
      ? await createRefundsForLine(ctx, trx, {
          line,
          reason: args.reason ?? 'Line cancelled',
          actor: args.actor,
        })
      : [];
  return { changed: true, line, state: next.state, refundIds };
}

/** Map a unique-violation on the live-issue index to a 409. */
export function asIssueConflict(error: unknown): never {
  const e = error as { code?: string; constraint?: string };
  if (e.code === '23505' && e.constraint === 'issue_live_uq') {
    throw conflict(
      'issue_already_open',
      'This problem has already been reported and is being handled.',
    );
  }
  throw error;
}

export const requireOpen = (line: LineRow): void => {
  if (line.state === 'Cancelled' || line.state === 'Refunded') {
    throw new RuleViolation('line_closed', 'This line is already cancelled or refunded.');
  }
};
