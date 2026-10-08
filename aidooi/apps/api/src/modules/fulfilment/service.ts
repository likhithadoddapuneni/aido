import type { z } from 'zod';
import type { ProofUploadBodySchema, ProofUploadSchema } from '@aidooi/contracts';
import { advance, isAutoConfirmDue, type OrderLineState } from '@aidooi/domain';
import { recordAudit } from '../../audit.ts';
import { runAsSystem, type AppContext } from '../../context.ts';
import type { ApiActor } from '../../http/actor.ts';
import { notFound } from '../../http/problem.ts';
import { RuleViolation } from '@aidooi/domain';
import { factsOf, lockLine, openIssueCount, persistFacts, transitionLine } from './lines.ts';
import { executeRefundsNow } from './refunds.ts';

const TEMPLATE_BY_STATE: Partial<Record<OrderLineState, string>> = {
  Preparing: 'fulfilment.line_preparing',
  'Ready for Dispatch': 'fulfilment.line_ready',
  Dispatched: 'fulfilment.line_dispatched',
  Delivered: 'fulfilment.line_delivered',
  Cancelled: 'fulfilment.line_cancelled',
};

/** Seller or ops moves a line. Ownership is enforced here because the platform, not RLS, writes. */
export async function advanceLine(
  ctx: AppContext,
  args: {
    lineId: string;
    to: OrderLineState;
    actor: ApiActor;
    partnerId?: string;
    reason?: string | undefined;
    proofPhotoKey?: string | undefined;
    correlationId?: string;
  },
): Promise<{ state: OrderLineState; changed: boolean }> {
  if (args.to === 'Delivered' && !args.proofPhotoKey) {
    throw new RuleViolation(
      'proof_of_delivery_required',
      'A delivery photo is required to mark a line Delivered.',
    );
  }
  const res = await runAsSystem(
    ctx,
    (trx) =>
      transitionLine(ctx, trx, {
        lineId: args.lineId,
        owner: args.partnerId ? { partnerId: args.partnerId } : {},
        to: args.to,
        actor: args.actor,
        reason: args.reason,
        data: {
          ...(args.proofPhotoKey ? { proofPhotoKey: args.proofPhotoKey } : {}),
          channel: args.actor.kind,
        },
      }),
    args.correlationId,
  );
  if (res.changed) {
    const template = TEMPLATE_BY_STATE[res.state];
    if (template) {
      await ctx.notifier.send({
        template,
        to: { kind: 'customer', id: res.line.customerId },
        data: { orderLineId: res.line.id, state: res.state },
        dedupeKey: `line:${res.line.id}:${res.state}`,
      });
    }
    await executeRefundsNow(ctx, res.refundIds);
  }
  return { state: res.state, changed: res.changed };
}

/** The buyer confirms receipt; the line becomes settlement-eligible (AID-LOG-014 §6). */
export async function confirmReceipt(
  ctx: AppContext,
  args: {
    orderId: string;
    lineId: string;
    customerId: string;
    actor: ApiActor;
    correlationId?: string;
  },
) {
  const res = await runAsSystem(
    ctx,
    (trx) =>
      transitionLine(ctx, trx, {
        lineId: args.lineId,
        owner: { customerId: args.customerId, masterOrderId: args.orderId },
        to: 'Receipt Confirmed',
        actor: args.actor,
      }),
    args.correlationId,
  );
  return res;
}

/**
 * AID-LOG-015 §7. Receipt is confirmed automatically 72 hours after delivery when no issue is open.
 * Rows are taken with SKIP LOCKED, so concurrent sweepers divide the work and never repeat it.
 */
export async function sweepAutoConfirm(ctx: AppContext, batch = 200): Promise<number> {
  const now = ctx.clock.now();
  // Coarse filter in SQL; the exact rule is the domain's.
  const cutoff = new Date(now - 72 * 3_600_000);
  const candidates = await runAsSystem(ctx, (trx) =>
    trx
      .selectFrom('fulfilment.order_line')
      .select('id')
      .where('state', '=', 'Delivered')
      .where('delivered_at', '<', cutoff)
      .orderBy('delivered_at')
      .limit(batch)
      .execute(),
  );

  let confirmed = 0;
  for (const c of candidates) {
    const done = await runAsSystem(ctx, async (trx) => {
      const line = await lockLine(trx, c.id, {}, { skipLocked: true });
      if (!line || line.state !== 'Delivered') return null;
      const facts = factsOf(line, await openIssueCount(trx, line.id));
      if (!isAutoConfirmDue(facts, now)) return null;
      const next = advance(facts, 'Receipt Confirmed', now);
      await persistFacts(trx, line, next, now);
      await recordAudit(trx, {
        entityType: 'order_line',
        entityId: line.id,
        from: 'Delivered',
        to: 'Receipt Confirmed',
        actor: 'system',
        reason: 'Auto-confirmed 72 hours after delivery with no open issue',
      });
      return line;
    });
    if (done) {
      confirmed++;
      await ctx.notifier.send({
        template: 'fulfilment.receipt_auto_confirmed',
        to: { kind: 'customer', id: done.customerId },
        data: { orderLineId: done.id },
        dedupeKey: `line:${done.id}:Receipt Confirmed`,
      });
    }
  }
  return confirmed;
}

const PROOF_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const PROOF_TTL_MS = 15 * 60_000;

/**
 * A signed URL for the delivery-proof photograph of one of the seller's own lines. The storage key is
 * ours, never the client's, so a seller cannot point proof at someone else's object.
 */
export async function requestProofUpload(
  ctx: AppContext,
  seller: Extract<ApiActor, { kind: 'seller' }>,
  lineId: string,
  body: z.infer<typeof ProofUploadBodySchema>,
): Promise<z.infer<typeof ProofUploadSchema>> {
  const line = await runAsSystem(ctx, (trx) =>
    trx
      .selectFrom('fulfilment.order_line')
      .select('partner_id')
      .where('id', '=', lineId)
      .executeTakeFirst(),
  );
  // Another seller's line is indistinguishable from one that does not exist.
  if (!line || line.partner_id !== seller.partnerId) throw notFound('Order line');
  const storageKey = `proofs/${lineId}/${ctx.ids.uuid()}.${PROOF_EXT[body.contentType]}`;
  const expiresAt = new Date(ctx.clock.now() + PROOF_TTL_MS);
  const signed = await ctx.media.signUpload({
    key: storageKey,
    contentType: body.contentType,
    maxBytes: body.sizeBytes,
    expiresAt,
  });
  return {
    storageKey,
    uploadUrl: signed.url,
    expiresAt: expiresAt.toISOString(),
    method: 'PUT',
    headers: signed.headers,
  };
}
