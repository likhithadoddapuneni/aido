import { PURCHASE_CONFIRMATION_SLA_HOURS } from '@aidooi/domain';
import { runAsSystem } from '../../context.ts';
import type { JobHandlers } from '../../jobs/types.ts';
import { lapseTask } from './seller-tasks.ts';
import { resume } from './webhook.ts';
import { recordAudit } from '../../audit.ts';
import { lockPayment, setPaymentState } from './payments-repo.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Background housekeeping for checkout. Every handler is idempotent: running twice is harmless. */
export const commerceJobs: JobHandlers = {
  /** A purchase window that has passed releases its hold on stock. */
  'commerce.expire_reservations': async (ctx) => {
    await runAsSystem(ctx, async (trx) => {
      const expired = await trx
        .updateTable('commerce.reservation')
        .set({ state: 'Expired' })
        .where('state', '=', 'Active')
        .where('expires_at', '<', new Date(ctx.clock.now()))
        .returning(['id', 'purchase_request_id'])
        .execute();
      for (const r of expired) {
        await recordAudit(trx, {
          entityType: 'reservation',
          entityId: r.id,
          from: 'Active',
          to: 'Expired',
          actor: 'system',
        });
      }
    });
  },

  /**
   * Sellers who do not answer in time: escalate to ops at half the SLA, and at the SLA treat the
   * confirmation as declined so the buyer is never left waiting on a silent seller (ADR-028).
   */
  'commerce.sweep_confirmations': async (ctx) => {
    const now = ctx.clock.now();
    const open = await runAsSystem(ctx, (trx) =>
      trx
        .selectFrom('commerce.confirmation_task')
        .select(['id', 'due_at', 'created_at', 'escalated_at', 'partner_id'])
        .where('task_type', '=', 'purchase')
        .where('response', 'is', null)
        .execute(),
    );
    for (const t of open) {
      const due = new Date(t.due_at).getTime();
      const created = due - PURCHASE_CONFIRMATION_SLA_HOURS * HOUR;
      if (now >= due) {
        const lapsed = await runAsSystem(ctx, (trx) => lapseTask(ctx, trx, t.id));
        if (lapsed) {
          await ctx.notifier.send({
            template: 'checkout.seller_declined',
            to: { kind: 'customer', id: lapsed.customerId },
            data: { checkoutId: lapsed.requestId },
            dedupeKey: `task:${t.id}:lapsed`,
          });
        }
      } else if (!t.escalated_at && now >= created + (due - created) / 2) {
        await runAsSystem(ctx, (trx) =>
          trx
            .updateTable('commerce.confirmation_task')
            .set({ escalated_at: new Date(now) })
            .where('id', '=', t.id)
            .where('escalated_at', 'is', null)
            .execute(),
        );
        await ctx.notifier.send({
          template: 'ops.seller_unresponsive',
          to: { kind: 'ops' },
          data: { taskId: t.id, partnerId: t.partner_id },
          dedupeKey: `task:${t.id}:escalated`,
        });
      }
    }
  },

  /**
   * Crash recovery. A payment authorised for over two minutes with no order means a process died
   * mid-saga: drive it forward (every step is idempotent). A 3-D Secure challenge abandoned for
   * half an hour is closed.
   */
  'commerce.resume_payments': async (ctx) => {
    const now = ctx.clock.now();
    const stuck = await runAsSystem(ctx, (trx) =>
      trx
        .selectFrom('commerce.payment as p')
        .select(['p.id', 'p.state', 'p.provider_ref', 'p.created_at', 'p.authorized_at'])
        .where('p.purpose', '=', 'Order')
        .where('p.state', 'in', ['Authorized', 'Pending'])
        .where('p.created_at', '<', new Date(now - 2 * MIN))
        .execute(),
    );
    for (const p of stuck) {
      if (p.state === 'Authorized') {
        await resume(ctx, p.id);
      } else if (p.provider_ref && new Date(p.created_at).getTime() < now - 30 * MIN) {
        await runAsSystem(ctx, async (trx) => {
          const locked = await lockPayment(trx, p.id);
          if (locked.state !== 'Pending') return;
          await setPaymentState(trx, locked, 'Failed', { failure_code: 'abandoned' });
          await recordAudit(trx, {
            entityType: 'payment',
            entityId: p.id,
            from: 'Pending',
            to: 'Failed',
            actor: 'system',
            reason: 'authentication abandoned',
          });
        });
      }
    }
  },
};
