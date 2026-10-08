import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { PurchaseTasksSchema } from '@aidooi/contracts';
import { instant } from '@aidooi/domain';
import { recordAudit } from '../../audit.ts';
import { runAs, type AppContext, type Tx } from '../../context.ts';
import { requireSeller } from '../../http/actor.ts';
import { conflict, notFound } from '../../http/problem.ts';
import { failValidation, loadView, validateAndExtend } from './checkout.ts';

type Tasks = z.infer<typeof PurchaseTasksSchema>;

/** The seller's open purchase confirmations, with exactly what they are being asked to stand behind. */
export async function listPurchaseTasks(ctx: AppContext, req: FastifyRequest): Promise<Tasks> {
  const seller = requireSeller(req);
  return runAs(ctx, req, async (trx) => {
    const tasks = await trx
      .selectFrom('commerce.confirmation_task')
      .select(['id', 'due_at', 'response', 'reservation_id'])
      .where('task_type', '=', 'purchase')
      .where('partner_id', '=', seller.partnerId)
      .orderBy('due_at')
      .limit(100)
      .execute();
    const out: Tasks['tasks'] = [];
    for (const t of tasks) {
      const lines = await trx
        .selectFrom('commerce.reservation as r')
        .innerJoin(
          'commerce.purchase_request_line as l',
          'l.purchase_request_id',
          'r.purchase_request_id',
        )
        .innerJoin('catalogue.seller_offer as o', 'o.id', 'l.offer_id')
        .innerJoin('catalogue.product as p', 'p.id', 'o.product_id')
        .select([
          'o.id as offer_id',
          'p.name',
          'o.seller_sku',
          'l.quantity',
          'l.quoted_unit_price_fils',
          'o.stock_qty',
        ])
        .where('r.id', '=', t.reservation_id as string)
        .where('o.partner_id', '=', seller.partnerId)
        .execute();
      out.push({
        id: t.id,
        dueAt: new Date(t.due_at).toISOString(),
        responded: t.response as 'Confirmed' | 'Declined' | null,
        lines: lines.map((l) => ({
          offerId: l.offer_id,
          productName: l.name,
          sellerSku: l.seller_sku,
          quantity: l.quantity,
          unitPrice: Number(l.quoted_unit_price_fils),
          stockQty: l.stock_qty,
        })),
      });
    }
    return { tasks: out };
  });
}

/**
 * A seller stands behind (or refuses) the stock and price of their lines. The last confirmation
 * starts the buyer's 24-hour purchase window; a refusal sends the checkout back to be rebuilt.
 * Answering twice the same way is a no-op; answering differently is a conflict.
 */
export async function respondToPurchaseTask(
  ctx: AppContext,
  req: FastifyRequest,
  taskId: string,
  response: 'Confirmed' | 'Declined',
): Promise<{ id: string; response: 'Confirmed' | 'Declined' }> {
  const seller = requireSeller(req);
  const result = await runAs(ctx, req, async (trx) => {
    const task = await trx
      .selectFrom('commerce.confirmation_task')
      .selectAll()
      .where('id', '=', taskId)
      .where('task_type', '=', 'purchase')
      .forUpdate()
      .executeTakeFirst();
    // RLS hides other partners' tasks, so "not yours" and "not there" are the same answer.
    if (!task || task.partner_id !== seller.partnerId) throw notFound('Task');
    if (task.response) {
      if (task.response === response) return { applied: false as const, customerId: null };
      throw conflict(
        'task_already_answered',
        `This confirmation was already ${task.response.toLowerCase()}.`,
      );
    }
    const now = instant(ctx.clock.now());
    await trx
      .updateTable('commerce.confirmation_task')
      .set({
        response,
        responded_at: new Date(now),
        responded_by_seller_user_id: seller.sellerUserId,
      })
      .where('id', '=', taskId)
      .execute();

    const reservation = await trx
      .selectFrom('commerce.reservation')
      .select(['id', 'purchase_request_id'])
      .where('id', '=', task.reservation_id as string)
      .executeTakeFirstOrThrow();
    const requestId = reservation.purchase_request_id;
    const request = await trx
      .selectFrom('commerce.purchase_request')
      .select(['customer_id', 'validation_state'])
      .where('id', '=', requestId)
      .executeTakeFirstOrThrow();
    if (request.validation_state === 'Validation Pending') {
      if (response === 'Declined') {
        await failValidation(trx, requestId);
      } else {
        const v = await loadView(trx, requestId);
        const priceChanged = v.validations.some((x) => x.status === 'Price Changed');
        if (v.openTasks === 0 && !priceChanged) await validateAndExtend(ctx, trx, requestId);
      }
    }
    await recordAudit(trx, {
      entityType: 'confirmation_task',
      entityId: taskId,
      from: null,
      to: response,
      actor: req.actor!,
      data: { requestId },
    });
    return { applied: true as const, customerId: request.customer_id, requestId };
  });

  if (result.applied) {
    await ctx.notifier.send({
      template: response === 'Confirmed' ? 'checkout.seller_confirmed' : 'checkout.seller_declined',
      to: { kind: 'customer', id: result.customerId },
      data: { checkoutId: result.requestId },
      dedupeKey: `task:${taskId}:${response}`,
    });
  }
  return { id: taskId, response };
}

/** Exposed for the sweeper: a task that lapses counts as declined, recorded as the system's answer. */
export async function lapseTask(
  ctx: AppContext,
  trx: Tx,
  taskId: string,
): Promise<{ customerId: string; requestId: string } | null> {
  const task = await trx
    .selectFrom('commerce.confirmation_task')
    .selectAll()
    .where('id', '=', taskId)
    .forUpdate()
    .executeTakeFirst();
  if (!task || task.response || !task.reservation_id) return null;
  await trx
    .updateTable('commerce.confirmation_task')
    .set({ response: 'Declined', responded_at: new Date(ctx.clock.now()) })
    .where('id', '=', taskId)
    .execute();
  const reservation = await trx
    .selectFrom('commerce.reservation')
    .select('purchase_request_id')
    .where('id', '=', task.reservation_id)
    .executeTakeFirstOrThrow();
  const request = await trx
    .selectFrom('commerce.purchase_request')
    .select(['customer_id', 'validation_state'])
    .where('id', '=', reservation.purchase_request_id)
    .executeTakeFirstOrThrow();
  if (request.validation_state === 'Validation Pending')
    await failValidation(trx, reservation.purchase_request_id);
  await recordAudit(trx, {
    entityType: 'confirmation_task',
    entityId: taskId,
    from: null,
    to: 'Declined',
    actor: 'system',
    reason: 'sla_lapsed',
  });
  return { customerId: request.customer_id, requestId: reservation.purchase_request_id };
}
