import {
  RuleViolation,
  assertTransition,
  issue as issueMachine,
  onIssueClosed,
  onIssueRaised,
  type IssueFlag,
  type IssueState,
  type OrderLineState,
} from '@aidooi/domain';
import { recordAudit } from '../../audit.ts';
import type { AppContext, Tx } from '../../context.ts';
import type { ApiActor } from '../../http/actor.ts';
import { notFound } from '../../http/problem.ts';
import {
  asIssueConflict,
  factsOf,
  lockLine,
  openIssueCount,
  persistFacts,
  requireLine,
  requireOpen,
  type LineRow,
  type Ownership,
} from './lines.ts';
import { createRefundsForLine } from './refunds.ts';

export interface IssueRow {
  readonly id: string;
  readonly orderLineId: string;
  readonly partnerId: string;
  readonly customerId: string;
  readonly flag: IssueFlag;
  readonly state: IssueState;
}

/** A buyer reports a problem with a line. An eligible line's settlement goes on hold (AID-LOG-015). */
export async function raiseIssue(
  ctx: AppContext,
  trx: Tx,
  args: {
    lineId: string;
    owner: Ownership;
    flag: IssueFlag;
    note?: string | undefined;
    actor: ApiActor;
    raisedByCustomerId: string;
  },
): Promise<{ issueId: string }> {
  const line = await requireLine(trx, args.lineId, args.owner);
  requireOpen(line);

  let issueId: string;
  try {
    const row = await trx
      .insertInto('fulfilment.issue')
      .values({
        id: ctx.ids.uuid(),
        order_line_id: line.id,
        partner_id: line.partnerId,
        customer_id: line.customerId,
        flag: args.flag,
        note: args.note ?? null,
        raised_by_customer_id: args.raisedByCustomerId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    issueId = row.id;
  } catch (e) {
    asIssueConflict(e);
  }

  const now = ctx.clock.now();
  const facts = onIssueRaised(factsOf(line, (await openIssueCount(trx, line.id)) - 1));
  await persistFacts(trx, line, facts, now);
  await recordAudit(trx, {
    entityType: 'issue',
    entityId: issueId,
    from: null,
    to: 'Open',
    actor: args.actor,
    data: {
      orderLineId: line.id,
      flag: args.flag,
      settlementBefore: line.settlement,
      settlementAfter: facts.settlement,
    },
  });
  return { issueId };
}

export async function lockIssue(trx: Tx, id: string, partnerId?: string): Promise<IssueRow> {
  let q = trx
    .selectFrom('fulfilment.issue')
    .select(['id', 'order_line_id', 'partner_id', 'customer_id', 'flag', 'state'])
    .where('id', '=', id);
  if (partnerId) q = q.where('partner_id', '=', partnerId);
  const r = await q.forUpdate().executeTakeFirst();
  if (!r) throw notFound('Issue');
  return {
    id: r.id,
    orderLineId: r.order_line_id,
    partnerId: r.partner_id,
    customerId: r.customer_id,
    flag: r.flag as IssueFlag,
    state: r.state as IssueState,
  };
}

export async function markPartnerHandling(
  trx: Tx,
  row: IssueRow,
  note: string,
  actor: ApiActor,
): Promise<void> {
  if (row.state === 'Partner Handling') return;
  assertTransition(issueMachine, row.state, 'Partner Handling');
  await trx
    .updateTable('fulfilment.issue')
    .set({ state: 'Partner Handling', resolution_note: note })
    .where('id', '=', row.id)
    .execute();
  await recordAudit(trx, {
    entityType: 'issue',
    entityId: row.id,
    from: row.state,
    to: 'Partner Handling',
    actor,
    reason: note,
  });
}

export interface CloseResult {
  readonly lineState: OrderLineState;
  readonly refundIds: readonly string[];
}

/**
 * Close an issue and apply its consequences to the line, in one transaction:
 * Resolved/Rejected release any settlement hold; Refunded ends the line and creates the refund
 * (Cancelled instead of Refunded when the buyer asked to cancel before dispatch).
 */
export async function closeIssue(
  ctx: AppContext,
  trx: Tx,
  row: IssueRow,
  args: {
    resolution: 'Resolved' | 'Refunded' | 'Rejected';
    note: string;
    actor: ApiActor;
    refundAmountFils?: number | undefined;
  },
): Promise<CloseResult> {
  if (row.state === 'Resolved' || row.state === 'Refunded' || row.state === 'Rejected') {
    throw new RuleViolation('issue_closed', 'This issue is already closed.');
  }
  assertTransition(issueMachine, row.state, args.resolution);
  const line = (await lockLine(trx, row.orderLineId, {})) as LineRow;
  const now = ctx.clock.now();
  const open = await openIssueCount(trx, line.id);

  if (args.resolution === 'Refunded') requireOpen(line);
  if (
    args.resolution === 'Refunded' &&
    args.refundAmountFils !== undefined &&
    args.refundAmountFils !== line.grossLine
  ) {
    throw new RuleViolation(
      'partial_refund_unsupported',
      'Only a refund of the whole line is supported.',
    );
  }

  await trx
    .updateTable('fulfilment.issue')
    .set({ state: args.resolution, resolved_at: new Date(now), resolution_note: args.note })
    .where('id', '=', row.id)
    .execute();
  await recordAudit(trx, {
    entityType: 'issue',
    entityId: row.id,
    from: row.state,
    to: args.resolution,
    actor: args.actor,
    reason: args.note,
  });

  let facts = onIssueClosed(factsOf(line, open), args.resolution);
  let refundIds: string[] = [];

  if (args.resolution === 'Refunded') {
    const early =
      line.state === 'Confirmed' ||
      line.state === 'Preparing' ||
      line.state === 'Ready for Dispatch';
    if (row.flag === 'Cancellation Requested' && early)
      facts = { ...facts, state: 'Cancelled', settlement: 'Not Eligible' };
    // Other live issues on a line that no longer exists as a sale have nothing left to resolve.
    const siblings = await trx
      .selectFrom('fulfilment.issue')
      .select(['id', 'state'])
      .where('order_line_id', '=', line.id)
      .where('id', '<>', row.id)
      .where('state', 'in', ['Open', 'Partner Handling'])
      .forUpdate()
      .execute();
    for (const s of siblings) {
      await trx
        .updateTable('fulfilment.issue')
        .set({
          state: 'Resolved',
          resolved_at: new Date(now),
          resolution_note: 'Closed: the line was refunded.',
        })
        .where('id', '=', s.id)
        .execute();
      await recordAudit(trx, {
        entityType: 'issue',
        entityId: s.id,
        from: s.state,
        to: 'Resolved',
        actor: 'system',
        reason: 'Line refunded',
      });
    }
    facts = { ...facts, openIssues: 0 };
    await persistFacts(trx, line, facts, now);
    await recordAudit(trx, {
      entityType: 'order_line',
      entityId: line.id,
      from: line.state,
      to: facts.state,
      actor: args.actor,
      reason: `Issue ${row.flag}: ${args.note}`,
    });
    refundIds = await createRefundsForLine(ctx, trx, {
      line,
      reason: `${row.flag}: ${args.note}`,
      actor: args.actor,
    });
  } else {
    await persistFacts(trx, line, facts, now);
    if (facts.settlement !== line.settlement) {
      await recordAudit(trx, {
        entityType: 'order_line',
        entityId: line.id,
        from: line.state,
        to: line.state,
        actor: args.actor,
        reason: `Settlement ${line.settlement} → ${facts.settlement}`,
      });
    }
  }
  return { lineState: facts.state, refundIds };
}
