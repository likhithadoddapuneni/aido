import type { AppContext } from '../../context.ts';

type Payload = Record<string, unknown>;

/** `order.placed`: tell the buyer, and every seller who now has something to prepare. */
export async function orderPlaced(ctx: AppContext, p: Payload): Promise<void> {
  const orderId = String(p['orderId']);
  await ctx.notifier.send({
    template: 'order.confirmed',
    to: { kind: 'customer', id: String(p['customerId']) },
    data: { orderId, gross: Number(p['gross']) },
    dedupeKey: `order.placed:${orderId}:customer`,
  });
  for (const partnerId of (p['partnerIds'] as string[] | undefined) ?? []) {
    await ctx.notifier.send({
      template: 'order.new_for_seller',
      to: { kind: 'partner', id: partnerId },
      data: { orderId },
      dedupeKey: `order.placed:${orderId}:${partnerId}`,
    });
  }
}
