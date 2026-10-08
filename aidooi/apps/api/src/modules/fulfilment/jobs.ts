import { z } from 'zod';
import type { JobHandlers } from '../../jobs/types.ts';
import { runAsSystem } from '../../context.ts';
import { executeRefund } from './refunds.ts';
import { sweepAutoConfirm } from './service.ts';

const RefundPayload = z.object({ refundId: z.uuid() });
const DEFAULT_DELIVERY_DAYS = 14;

/** Background jobs of the `fulfilment` module. */
export const fulfilmentJobs: JobHandlers = {
  'fulfilment.sweep_auto_confirm': async (ctx) => {
    await sweepAutoConfirm(ctx);
  },

  /** Finish a refund whose provider call did not complete. A timeout throws, so the runner backs off and retries. */
  'fulfilment.retry_refund': async (ctx, job) => {
    await executeRefund(ctx, RefundPayload.parse(job.payload).refundId);
  },

  /** Tell the seller about lines past their promised delivery window; one notification per line, ever. */
  'fulfilment.notify_overdue': async (ctx) => {
    const now = ctx.clock.now();
    const overdue = await runAsSystem(ctx, (trx) =>
      trx
        .selectFrom('fulfilment.order_line')
        .select(['id', 'partner_id', 'snapshot', 'created_at'])
        .where('state', 'in', ['Confirmed', 'Preparing', 'Ready for Dispatch', 'Dispatched'])
        .where('created_at', '<', new Date(now - 24 * 3_600_000))
        .limit(500)
        .execute(),
    );
    for (const l of overdue) {
      const snap = l.snapshot as { deliveryDays?: number };
      const due =
        new Date(l.created_at).getTime() +
        (snap.deliveryDays ?? DEFAULT_DELIVERY_DAYS) * 86_400_000;
      if (now <= due) continue;
      await ctx.notifier.send({
        template: 'fulfilment.line_overdue',
        to: { kind: 'partner', id: l.partner_id },
        data: { orderLineId: l.id },
        dedupeKey: `overdue:${l.id}`,
      });
    }
  },
};
