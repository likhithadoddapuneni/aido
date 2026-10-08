import { creditWindowElapsed, dispositionAfter, fils, instant } from '@aidooi/domain';
import { recordAudit } from '../../audit.ts';
import { runAsSystem } from '../../context.ts';
import type { JobHandlers } from '../../jobs/types.ts';
import { createRefund, processRefund } from './refunds.ts';
import { loadData, lockRequest } from './repo.ts';
import { markNoShow, resolveRequest } from './seller.ts';
import { Outbox, addAttribution, at, evaluateRequest, setRequestState } from './transitions.ts';

const payloadOf = <T>(p: unknown): T => p as T;

/** A job that runs ahead of its business deadline (clock skew, a manual re-run) fails and is retried. */
class NotDue extends Error {
  constructor(what: string) {
    super(`${what} is not due yet`);
  }
}

export const viewingJobs: JobHandlers = {
  /** Halfway through the seller SLA with no answer: tell operations so they can phone the showroom. */
  'viewing.escalate_confirmation': async (ctx, job) => {
    const { taskId } = payloadOf<{ taskId: string }>(job.payload);
    const out = new Outbox();
    await runAsSystem(ctx, async (trx) => {
      const task = await trx
        .selectFrom('commerce.confirmation_task as t')
        .innerJoin('viewing.viewing_stop as s', 's.id', 't.viewing_stop_id')
        .innerJoin('viewing.viewing_request as r', 'r.id', 's.viewing_request_id')
        .select([
          't.id',
          't.partner_id',
          't.response',
          't.escalated_at',
          'r.state',
          'r.id as request_id',
        ])
        .where('t.id', '=', taskId)
        .executeTakeFirst();
      if (
        !task ||
        task.response ||
        task.escalated_at ||
        task.state !== 'Awaiting Seller Confirmation'
      )
        return;
      await trx
        .updateTable('commerce.confirmation_task')
        .set({ escalated_at: at(ctx) })
        .where('id', '=', taskId)
        .execute();
      out.add({
        template: 'viewing.confirmation_overdue',
        to: { kind: 'ops' },
        data: { taskId, partnerId: task.partner_id, viewingId: task.request_id },
        dedupeKey: `viewing.escalated:${taskId}`,
      });
    });
    await out.flush(ctx);
  },

  /**
   * `sla`: showrooms that never answered are treated as having declined, and the request moves on.
   * `decision`: the buyer was asked how to proceed after a decline and did not; the request lapses.
   * No money can have moved yet in either case (a deposit is only requested once the request is
   * ready), but a Paid deposit is still refunded defensively.
   */
  'viewing.expire_unconfirmed': async (ctx, job) => {
    const { viewingRequestId, phase } = payloadOf<{
      viewingRequestId: string;
      phase: 'sla' | 'decision';
    }>(job.payload);
    const out = new Outbox();
    let refundId: string | null = null;
    await runAsSystem(ctx, async (trx) => {
      const request = await lockRequest(trx, viewingRequestId);
      if (request.state !== 'Awaiting Seller Confirmation') return;
      if (phase === 'sla') {
        const data = await loadData(trx, viewingRequestId);
        const tasks = await trx
          .selectFrom('commerce.confirmation_task')
          .select(['id', 'viewing_stop_id', 'due_at'])
          .where(
            'viewing_stop_id',
            'in',
            data.stops.filter((s) => s.confirmation_state === 'Pending').map((s) => s.id),
          )
          .where('response', 'is', null)
          .execute();
        if (tasks.some((t) => new Date(t.due_at).getTime() > ctx.clock.now()))
          throw new NotDue('The confirmation deadline');
        for (const t of tasks) {
          await trx
            .updateTable('commerce.confirmation_task')
            .set({ response: 'Declined', responded_at: at(ctx) })
            .where('id', '=', t.id)
            .execute();
          await trx
            .updateTable('viewing.viewing_stop')
            .set({ confirmation_state: 'Declined', responded_at: at(ctx) })
            .where('id', '=', t.viewing_stop_id as string)
            .execute();
          await recordAudit(trx, {
            entityType: 'viewing_stop',
            entityId: t.viewing_stop_id as string,
            from: 'Pending',
            to: 'Declined',
            actor: 'system',
            reason: 'seller did not respond within the SLA',
          });
          out.add({
            template: 'viewing.stop_declined',
            to: { kind: 'customer', id: request.customer_id },
            data: {
              viewingId: request.id,
              stopId: t.viewing_stop_id as string,
              reason: 'no_response',
            },
            dedupeKey: `viewing.stop-declined:${t.viewing_stop_id}`,
          });
        }
        await evaluateRequest(trx, ctx, viewingRequestId, out);
        return;
      }
      const data = await loadData(trx, viewingRequestId);
      await setRequestState(
        trx,
        request,
        'Cancelled',
        'system',
        {},
        'buyer did not decide after a declined stop',
      );
      out.add({
        template: 'viewing.cancelled',
        to: { kind: 'customer', id: request.customer_id },
        data: { viewingId: request.id, reason: 'no_decision' },
        dedupeKey: `viewing.cancelled:${request.id}`,
      });
      if (data.deposit?.state === 'Paid') {
        refundId = await createRefund(trx, ctx, {
          depositId: data.deposit.id,
          amount: fils(Number(data.deposit.amount_fils)),
          reason: 'viewing_cancelled',
        });
      }
    });
    await out.flush(ctx);
    if (refundId) await processRefund(ctx, refundId);
  },

  /** Seven days after a completed viewing with no purchase: the deposit goes back in full. */
  'viewing.release_deposit': async (ctx, job) => {
    const { viewingRequestId } = payloadOf<{ viewingRequestId: string }>(job.payload);
    let refundId: string | null = null;
    await runAsSystem(ctx, async (trx) => {
      const request = await lockRequest(trx, viewingRequestId);
      const data = await loadData(trx, viewingRequestId);
      if (request.state !== 'Completed' || data.deposit?.state !== 'Paid' || !request.outcome_at)
        return;
      const hold = dispositionAfter('Completed', instant(new Date(request.outcome_at).getTime()));
      if (hold.kind !== 'hold' || !creditWindowElapsed(hold.until, instant(ctx.clock.now())))
        throw new NotDue('The deposit credit window');
      refundId = await createRefund(trx, ctx, {
        depositId: data.deposit.id,
        amount: fils(Number(data.deposit.amount_fils)),
        reason: 'deposit_unused',
      });
      await addAttribution(trx, request.id, 'Not Purchased', 'credit window elapsed');
    });
    if (refundId) await processRefund(ctx, refundId);
  },

  /** Execute a recorded refund (cancellation, unused deposit, or the part of a deposit an order did not use). */
  'viewing.process_refund': async (ctx, job) => {
    await processRefund(ctx, payloadOf<{ refundId: string }>(job.payload).refundId);
  },

  /** A day after the scheduled visit with nobody checked in anywhere: the buyer did not come. */
  'viewing.resolve_unattended': async (ctx, job) => {
    const { viewingRequestId } = payloadOf<{ viewingRequestId: string }>(job.payload);
    const out = new Outbox();
    await runAsSystem(ctx, async (trx) => {
      const request = await lockRequest(trx, viewingRequestId);
      if (request.state !== 'Confirmed') return;
      const data = await loadData(trx, viewingRequestId);
      const confirmed = data.stops.filter((s) => s.confirmation_state === 'Confirmed');
      if (confirmed.some((s) => s.attendance === 'Attended' || s.checked_in_at)) {
        // The buyer was checked in but no showroom closed the visit out: checking in is attending.
        for (const s of confirmed.filter((s) => s.checked_in_at && !s.attendance)) {
          await trx
            .updateTable('viewing.viewing_stop')
            .set({ attendance: 'Attended', attendance_at: at(ctx) })
            .where('id', '=', s.id)
            .execute();
        }
        await resolveRequest(trx, ctx, viewingRequestId, out);
        return;
      }
      for (const s of confirmed.filter((s) => !s.attendance)) {
        await trx
          .updateTable('viewing.viewing_stop')
          .set({ attendance: 'No-show', attendance_at: at(ctx) })
          .where('id', '=', s.id)
          .execute();
      }
      await markNoShow(trx, ctx, await loadData(trx, viewingRequestId), out);
    });
    await out.flush(ctx);
  },
};
