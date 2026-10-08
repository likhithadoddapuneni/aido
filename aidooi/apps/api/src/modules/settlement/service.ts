import { sql } from 'kysely';
import {
  RuleViolation,
  fils,
  orderLineId,
  partnerId as partnerIdOf,
  settle,
  sub,
  type Fils,
  type SettlementLine,
} from '@aidooi/domain';
import { recordAudit } from '../../audit.ts';
import { runAsSystem, type AppContext, type Tx } from '../../context.ts';
import type { ApiActor } from '../../http/actor.ts';
import { conflict, forbidden, notFound } from '../../http/problem.ts';
import { postLedger } from '../../ledger.ts';

type OpsActor = Extract<ApiActor, { kind: 'ops' }>;

/** First instant after the period (UTC): a line confirmed before it belongs to this or an earlier run. */
const periodEnd = (period: string): Date => {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1));
};

export interface RunRow {
  readonly id: string;
  readonly partnerId: string;
  readonly partnerName: string;
  readonly period: string;
  readonly state: 'Draft' | 'Approved' | 'Paid';
  readonly gross: number;
  readonly commission: number;
  readonly adjustment: number;
  readonly net: number;
  readonly approvedAt: Date | null;
  readonly paidAt: Date | null;
  readonly payoutRef: string | null;
}

export async function loadRuns(
  trx: Tx,
  where: { id?: string; partnerId?: string; period?: string },
): Promise<RunRow[]> {
  let q = trx
    .selectFrom('settlement.settlement_run as r')
    .innerJoin('catalogue.partner as p', 'p.id', 'r.partner_id')
    .select([
      'r.id',
      'r.partner_id',
      'p.trade_name',
      'r.period',
      'r.state',
      'r.gross_fils',
      'r.commission_fils',
      'r.adjustment_fils',
      'r.net_fils',
      'r.approved_at',
      'r.paid_at',
      'r.payout_ref',
    ])
    .orderBy('r.period', 'desc')
    .orderBy('p.trade_name');
  if (where.id) q = q.where('r.id', '=', where.id);
  if (where.partnerId) q = q.where('r.partner_id', '=', where.partnerId);
  if (where.period) q = q.where('r.period', '=', where.period);
  return (await q.execute()).map((r) => ({
    id: r.id,
    partnerId: r.partner_id,
    partnerName: r.trade_name,
    period: r.period,
    state: r.state as RunRow['state'],
    gross: r.gross_fils,
    commission: r.commission_fils,
    adjustment: r.adjustment_fils,
    net: r.net_fils,
    approvedAt: r.approved_at ? new Date(r.approved_at) : null,
    paidAt: r.paid_at ? new Date(r.paid_at) : null,
    payoutRef: r.payout_ref,
  }));
}

/** Recompute a run's totals from its persisted lines — the lines are the truth, the columns a summary. */
async function refreshTotals(trx: Tx, runId: string): Promise<void> {
  const t = await trx
    .selectFrom('settlement.settlement_line')
    .select([
      sql<string>`coalesce(sum(gross_fils) FILTER (WHERE kind = 'Sale'), 0)`.as('gross'),
      sql<string>`coalesce(sum(commission_fils) FILTER (WHERE kind = 'Sale'), 0)`.as('commission'),
      sql<string>`coalesce(sum(gross_fils - commission_fils) FILTER (WHERE kind = 'Clawback'), 0)`.as(
        'adjustment',
      ),
    ])
    .where('run_id', '=', runId)
    .executeTakeFirstOrThrow();
  const gross = Number(t.gross);
  const commission = Number(t.commission);
  const adjustment = Number(t.adjustment);
  await trx
    .updateTable('settlement.settlement_run')
    .set({
      gross_fils: gross,
      commission_fils: commission,
      adjustment_fils: adjustment,
      net_fils: gross - commission - adjustment,
    })
    .where('id', '=', runId)
    .execute();
}

export interface CreateRunsResult {
  readonly runs: RunRow[];
  readonly held: { partnerId: string; gross: number }[];
}

/**
 * Build (or extend) the Draft run of every partner for `period`.
 *
 * Idempotent: a partner's run for a period is unique, lines already settled are never selected again
 * (their state moves to Included, and `(order_line, kind)` is unique), and runs that were approved are
 * left alone — anything that becomes eligible later rolls into a later period's run. An advisory lock
 * serialises overlapping invocations.
 *
 * Clawbacks (lines paid in an earlier run and refunded since) are applied only while the run's net
 * stays non-negative; the rest wait for a run that can absorb them, so a partner is never invoiced
 * through a negative payout and no clawback is lost.
 */
export async function createRuns(
  ctx: AppContext,
  period: string,
  actor: OpsActor,
  correlationId?: string,
): Promise<CreateRunsResult> {
  const end = periodEnd(period);
  return runAsSystem(
    ctx,
    async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'settlement:' + period}))`.execute(trx);

      const eligible = await trx
        .selectFrom('fulfilment.order_line')
        .select(['id', 'partner_id', 'gross_line_fils', 'commission_fils'])
        .where('state', '=', 'Receipt Confirmed')
        .where('settlement_state', '=', 'Eligible')
        .where('receipt_confirmed_at', '<', end)
        .orderBy('id')
        .forUpdate()
        .execute();

      const held = await trx
        .selectFrom('fulfilment.order_line')
        .select(['partner_id', (e) => e.fn.sum<string>('gross_line_fils').as('gross')])
        .where('settlement_state', '=', 'On Hold')
        .groupBy('partner_id')
        .execute();

      const clawable = await trx
        .selectFrom('fulfilment.order_line as l')
        .innerJoin('settlement.settlement_line as sale', (j) =>
          j.onRef('sale.order_line_id', '=', 'l.id').on('sale.kind', '=', 'Sale'),
        )
        .select([
          'l.id',
          'l.partner_id',
          'l.gross_line_fils',
          'l.commission_fils',
          'sale.run_id as sale_run',
        ])
        .where('l.state', '=', 'Refunded')
        .where('l.settlement_state', '=', 'Adjusted')
        .where((e) =>
          e.not(
            e.exists(
              e
                .selectFrom('settlement.settlement_line as c')
                .select(sql.lit(1).as('one'))
                .whereRef('c.order_line_id', '=', 'l.id')
                .where('c.kind', '=', 'Clawback'),
            ),
          ),
        )
        .orderBy('l.id')
        .execute();

      const existing = await loadRuns(trx, { period });
      const partners = new Set([
        ...eligible.map((l) => l.partner_id),
        ...clawable.map((l) => l.partner_id),
      ]);
      const touched: string[] = [];

      for (const partnerId of [...partners].sort()) {
        const run = existing.find((r) => r.partnerId === partnerId);
        if (run && run.state !== 'Draft') continue;

        const sales = eligible.filter((l) => l.partner_id === partnerId);
        const salesNet = sales.reduce((t, l) => t + l.gross_line_fils - l.commission_fils, 0);
        let budget = (run?.net ?? 0) + salesNet;
        const claws = [];
        for (const c of clawable.filter((l) => l.partner_id === partnerId)) {
          const net = c.gross_line_fils - c.commission_fils;
          if (budget - net < 0) continue;
          budget -= net;
          claws.push(c);
        }

        const input: SettlementLine[] = [
          ...sales.map((l) => ({
            lineId: orderLineId(l.id),
            partnerId: partnerIdOf(partnerId),
            gross: fils(l.gross_line_fils),
            commission: fils(l.commission_fils),
            state: 'Receipt Confirmed' as const,
            settlement: 'Eligible' as const,
            settledInRun: null,
            clawedBack: false,
          })),
          ...claws.map((l) => ({
            lineId: orderLineId(l.id),
            partnerId: partnerIdOf(partnerId),
            gross: fils(l.gross_line_fils),
            commission: fils(l.commission_fils),
            state: 'Refunded' as const,
            settlement: 'Adjusted' as const,
            settledInRun: l.sale_run,
            clawedBack: false,
          })),
        ];
        const [result] = settle(input);
        if (!result || result.entries.length === 0) continue;

        let runId = run?.id;
        if (!runId) {
          const row = await trx
            .insertInto('settlement.settlement_run')
            .values({ id: ctx.ids.uuid(), partner_id: partnerId, period })
            .returning('id')
            .executeTakeFirstOrThrow();
          runId = row.id;
        }
        const byId = new Map([...sales, ...claws].map((l) => [l.id, l]));
        await trx
          .insertInto('settlement.settlement_line')
          .values(
            result.entries.map((e) => {
              const l = byId.get(e.lineId) as NonNullable<ReturnType<typeof byId.get>>;
              return {
                run_id: runId as string,
                partner_id: partnerId,
                order_line_id: e.lineId,
                kind: e.kind,
                gross_fils: l.gross_line_fils,
                commission_fils: l.commission_fils,
              };
            }),
          )
          .execute();
        const saleIds = result.entries.filter((e) => e.kind === 'Sale').map((e) => e.lineId);
        if (saleIds.length) {
          await trx
            .updateTable('fulfilment.order_line')
            .set({ settlement_state: 'Included' })
            .where('id', 'in', saleIds)
            .where('settlement_state', '=', 'Eligible')
            .execute();
        }
        await refreshTotals(trx, runId);
        await recordAudit(trx, {
          entityType: 'settlement_run',
          entityId: runId,
          from: run ? 'Draft' : null,
          to: 'Draft',
          actor,
          data: {
            period,
            sales: saleIds.length,
            clawbacks: result.entries.length - saleIds.length,
          },
        });
        touched.push(runId);
      }

      const runs = (await loadRuns(trx, { period })).filter(
        (r) => touched.includes(r.id) || existing.some((x) => x.id === r.id),
      );
      return { runs, held: held.map((h) => ({ partnerId: h.partner_id, gross: Number(h.gross) })) };
    },
    correlationId,
  );
}

/**
 * Four-eyes approval. The approver must be a finance user who took no part in building the run, so
 * no single person can both create and release a payout.
 *
 * Lines of this run that were refunded while the run was still a Draft are netted by a Clawback in
 * the same run (append-only lines cannot be removed), so the approved totals are exactly what is owed.
 */
export async function approveRun(
  ctx: AppContext,
  runId: string,
  actor: OpsActor,
  correlationId?: string,
): Promise<RunRow> {
  return runAsSystem(
    ctx,
    async (trx) => {
      const locked = await trx
        .selectFrom('settlement.settlement_run')
        .select(['id', 'state', 'partner_id'])
        .where('id', '=', runId)
        .forUpdate()
        .executeTakeFirst();
      if (!locked) throw notFound('Settlement run');
      if (locked.state !== 'Draft')
        throw conflict('run_not_draft', `This run is already ${locked.state}.`);

      const involved = await trx
        .selectFrom('audit.event')
        .select('id')
        .where('entity_type', '=', 'settlement_run')
        .where('entity_id', '=', runId)
        .where('actor_type', '=', 'ops_user')
        .where('actor_id', '=', actor.opsUserId)
        .limit(1)
        .executeTakeFirst();
      if (involved)
        throw forbidden('A run must be approved by someone other than the person who built it.');

      const refundedSince = await trx
        .selectFrom('settlement.settlement_line as s')
        .innerJoin('fulfilment.order_line as l', 'l.id', 's.order_line_id')
        .select(['l.id', 'l.gross_line_fils', 'l.commission_fils'])
        .where('s.run_id', '=', runId)
        .where('s.kind', '=', 'Sale')
        .where('l.state', '=', 'Refunded')
        .where((e) =>
          e.not(
            e.exists(
              e
                .selectFrom('settlement.settlement_line as c')
                .select(sql.lit(1).as('one'))
                .whereRef('c.order_line_id', '=', 'l.id')
                .where('c.kind', '=', 'Clawback'),
            ),
          ),
        )
        .execute();
      if (refundedSince.length) {
        await trx
          .insertInto('settlement.settlement_line')
          .values(
            refundedSince.map((l) => ({
              run_id: runId,
              partner_id: locked.partner_id,
              order_line_id: l.id,
              kind: 'Clawback' as const,
              gross_fils: l.gross_line_fils,
              commission_fils: l.commission_fils,
            })),
          )
          .execute();
        await refreshTotals(trx, runId);
      }

      const stale = await trx
        .selectFrom('settlement.settlement_line as s')
        .innerJoin('fulfilment.order_line as l', 'l.id', 's.order_line_id')
        .select('l.id')
        .where('s.run_id', '=', runId)
        .where('s.kind', '=', 'Sale')
        .where('l.settlement_state', 'not in', ['Included', 'Adjusted'])
        .limit(1)
        .executeTakeFirst();
      if (stale)
        throw conflict(
          'run_stale',
          'A line in this run changed after it was built; rebuild the run.',
        );

      const [run] = await loadRuns(trx, { id: runId });
      if (!run) throw notFound('Settlement run');

      const salesNet = sub(fils(run.gross), fils(run.commission));
      const claw = await trx
        .selectFrom('settlement.settlement_line')
        .select([
          sql<string>`coalesce(sum(gross_fils), 0)`.as('gross'),
          sql<string>`coalesce(sum(commission_fils), 0)`.as('commission'),
        ])
        .where('run_id', '=', runId)
        .where('kind', '=', 'Clawback')
        .executeTakeFirstOrThrow();
      const clawGross = fils(Number(claw.gross));
      const clawCommission = fils(Number(claw.commission));
      const seller = `seller_payable:${run.partnerId}`;
      const leg = (account: string, direction: 'debit' | 'credit', amount: Fils) => ({
        account,
        direction,
        amount,
      });
      await postLedger(
        trx,
        {
          id: ctx.ids.uuid(),
          refType: 'settlement_run',
          refId: runId,
          memo: `Settlement ${run.period}`,
        },
        [
          leg('sales_collected', 'debit', fils(run.gross)),
          leg(seller, 'credit', salesNet),
          leg('commission_revenue', 'credit', fils(run.commission)),
          leg(seller, 'debit', sub(clawGross, clawCommission)),
          leg('commission_revenue', 'debit', clawCommission),
          leg('sales_collected', 'credit', clawGross),
        ],
      );

      await trx
        .updateTable('settlement.settlement_run')
        .set({
          state: 'Approved',
          approved_by: actor.opsUserId,
          approved_at: new Date(ctx.clock.now()),
        })
        .where('id', '=', runId)
        .execute();
      await trx
        .insertInto('settlement.statement')
        .values({
          run_id: runId,
          partner_id: run.partnerId,
          document_key: `statements/${run.partnerId}/${run.period}.csv`,
          tax_invoice_no: `AID-${run.period.replace('-', '')}-${run.partnerId.slice(0, 8)}`,
        })
        .execute();
      await recordAudit(trx, {
        entityType: 'settlement_run',
        entityId: runId,
        from: 'Draft',
        to: 'Approved',
        actor,
        data: { netFils: run.net },
      });
      const [after] = await loadRuns(trx, { id: runId });
      return after as RunRow;
    },
    correlationId,
  );
}

/** Pay out an approved run: the seller's balance is settled against the bank and its lines become Paid. */
export async function markPaid(
  ctx: AppContext,
  runId: string,
  bankReference: string,
  actor: OpsActor,
  correlationId?: string,
): Promise<RunRow> {
  return runAsSystem(
    ctx,
    async (trx) => {
      const locked = await trx
        .selectFrom('settlement.settlement_run')
        .select(['id', 'state', 'net_fils', 'partner_id'])
        .where('id', '=', runId)
        .forUpdate()
        .executeTakeFirst();
      if (!locked) throw notFound('Settlement run');
      if (locked.state !== 'Approved')
        throw conflict(
          'run_not_approved',
          `Only an approved run can be paid; this one is ${locked.state}.`,
        );
      if (locked.net_fils <= 0)
        throw new RuleViolation('nothing_to_pay', 'This run has no positive balance to pay out.');

      await postLedger(
        trx,
        { id: ctx.ids.uuid(), refType: 'settlement_payout', refId: runId, memo: bankReference },
        [
          {
            account: `seller_payable:${locked.partner_id}`,
            direction: 'debit',
            amount: fils(locked.net_fils),
          },
          { account: 'bank', direction: 'credit', amount: fils(locked.net_fils) },
        ],
      );
      await trx
        .updateTable('fulfilment.order_line')
        .set({ settlement_state: 'Paid' })
        .where('settlement_state', '=', 'Included')
        .where(
          'id',
          'in',
          trx
            .selectFrom('settlement.settlement_line')
            .select('order_line_id')
            .where('run_id', '=', runId)
            .where('kind', '=', 'Sale'),
        )
        .execute();
      await trx
        .updateTable('settlement.settlement_run')
        .set({ state: 'Paid', paid_at: new Date(ctx.clock.now()), payout_ref: bankReference })
        .where('id', '=', runId)
        .execute();
      await recordAudit(trx, {
        entityType: 'settlement_run',
        entityId: runId,
        from: 'Approved',
        to: 'Paid',
        actor,
        data: { bankReference },
      });
      const [after] = await loadRuns(trx, { id: runId });
      return after as RunRow;
    },
    correlationId,
  );
}
