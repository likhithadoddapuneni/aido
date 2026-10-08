import { sql } from 'kysely';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { PerformanceSchema } from '@aidooi/contracts';
import { runAs, type AppContext } from '../../context.ts';
import { requireManager } from './common.ts';

type Performance = z.infer<typeof PerformanceSchema>;
const DAY_MS = 86_400_000;
const rate = (num: number, den: number): number | null => (den === 0 ? null : num / den);

/**
 * How a seller is doing, computed from the rows themselves with SQL aggregates, for this partner only
 * (row-level security is the backstop; every query also names the partner).
 *
 *  - Confirmation rate: of tasks created in the period that have been answered or have passed their
 *    deadline, the share confirmed. A silent seller counts against the rate (a lapse is recorded as a decline).
 *  - Response time: creation → answer, for tasks a seller person actually answered (lapses excluded).
 *  - On time: of non-cancelled lines whose promised delivery date has passed, the share delivered by it.
 *    The promise is the seller's own `deliveryDays`, locked in the order snapshot.
 *  - Issue rate: issues raised in the period per order line created in it.
 */
export async function performance(
  ctx: AppContext,
  req: FastifyRequest,
  period: '30d' | '90d',
): Promise<Performance> {
  const seller = requireManager(req);
  const to = new Date(ctx.clock.now());
  const from = new Date(to.getTime() - (period === '30d' ? 30 : 90) * DAY_MS);
  return runAs(ctx, req, async (trx) => {
    const tasks = await sql<{ task_type: string; requests: string; confirmed: string }>`
      SELECT task_type,
             count(*)::text AS requests,
             count(*) FILTER (WHERE response = 'Confirmed')::text AS confirmed
        FROM commerce.confirmation_task
       WHERE partner_id = ${seller.partnerId}::uuid
         AND created_at >= ${from} AND created_at < ${to}
         AND task_type IN ('purchase', 'viewing')
         AND (response IS NOT NULL OR due_at <= ${to})
       GROUP BY task_type`.execute(trx);
    const by = (t: string) => {
      const r = tasks.rows.find((x) => x.task_type === t);
      return { requests: Number(r?.requests ?? 0), confirmed: Number(r?.confirmed ?? 0) };
    };

    const times = await sql<{ median: number | null; p90: number | null }>`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY secs) AS median,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY secs) AS p90
        FROM (SELECT extract(epoch FROM responded_at - created_at) AS secs
                FROM commerce.confirmation_task
               WHERE partner_id = ${seller.partnerId}::uuid
                 AND created_at >= ${from} AND created_at < ${to}
                 AND responded_by_seller_user_id IS NOT NULL) t`.execute(trx);

    const lines = await sql<{ due: string; on_time: string }>`
      SELECT count(*)::text AS due,
             count(*) FILTER (WHERE delivered_at IS NOT NULL AND delivered_at <= eta)::text AS on_time
        FROM (SELECT delivered_at,
                     created_at + make_interval(days => (snapshot ->> 'deliveryDays')::int) AS eta
                FROM fulfilment.order_line
               WHERE partner_id = ${seller.partnerId}::uuid
                 AND created_at >= ${from} AND created_at < ${to}
                 AND state NOT IN ('Cancelled', 'Refunded')
                 AND snapshot ->> 'deliveryDays' IS NOT NULL) l
       WHERE eta <= ${to}`.execute(trx);

    const issues = await sql<{ lines: string; issues: string }>`
      SELECT (SELECT count(*) FROM fulfilment.order_line
               WHERE partner_id = ${seller.partnerId}::uuid AND created_at >= ${from} AND created_at < ${to})::text AS lines,
             (SELECT count(*) FROM fulfilment.issue
               WHERE partner_id = ${seller.partnerId}::uuid AND raised_at >= ${from} AND raised_at < ${to})::text AS issues`.execute(
      trx,
    );

    const purchase = by('purchase');
    const viewing = by('viewing');
    const due = Number(lines.rows[0]?.due ?? 0);
    const onTime = Number(lines.rows[0]?.on_time ?? 0);
    const nLines = Number(issues.rows[0]?.lines ?? 0);
    const nIssues = Number(issues.rows[0]?.issues ?? 0);
    return {
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      confirmation: {
        purchase: { ...purchase, rate: rate(purchase.confirmed, purchase.requests) },
        viewing: { ...viewing, rate: rate(viewing.confirmed, viewing.requests) },
        responseSeconds: { median: times.rows[0]?.median ?? null, p90: times.rows[0]?.p90 ?? null },
      },
      fulfilment: { dueLines: due, onTime, onTimeRate: rate(onTime, due) },
      issues: { lines: nLines, issues: nIssues, issueRate: rate(nIssues, nLines) },
    };
  });
}
