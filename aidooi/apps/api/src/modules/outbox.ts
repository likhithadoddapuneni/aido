import { sql } from 'kysely';
import { runAsSystem, type AppContext } from '../context.ts';
import { orderPlaced } from './commerce/notifications.ts';

export type OutboxHandler = (ctx: AppContext, payload: Record<string, unknown>) => Promise<void>;

/** Which module reacts to which outbox topic. A topic with no handler is an error, not silently dropped. */
export const OUTBOX_HANDLERS: Readonly<Record<string, OutboxHandler>> = {
  'order.placed': orderPlaced,
};

/**
 * Deliver events that were written in the same transaction as the change that caused them. Delivery
 * is at-least-once: a handler runs before the row is marked published, so a crash in between sends
 * again — which is why every notification carries a dedupe key.
 */
export async function relayOutbox(ctx: AppContext, limit = 50): Promise<number> {
  return runAsSystem(ctx, async (trx) => {
    const { rows } = await sql<{ id: string; topic: string; payload: Record<string, unknown> }>`
      SELECT id, topic, payload FROM platform.outbox_event
       WHERE published_at IS NULL ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED`.execute(
      trx,
    );
    for (const e of rows) {
      const handler = OUTBOX_HANDLERS[e.topic];
      if (!handler) throw new Error(`No outbox handler for topic ${e.topic}`);
      await handler(ctx, e.payload);
      await sql`UPDATE platform.outbox_event SET published_at = now() WHERE id = ${e.id}::uuid`.execute(
        trx,
      );
    }
    return rows.length;
  });
}
