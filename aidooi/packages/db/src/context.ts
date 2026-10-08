import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from './generated/db.ts';

export type Actor =
  | { readonly kind: 'ops' }
  | { readonly kind: 'system' }
  | { readonly kind: 'seller'; readonly partnerId: string }
  /** customerId is absent for guests, who may browse but own no rows. */
  | { readonly kind: 'buyer'; readonly customerId?: string };

export interface ActorOptions {
  readonly correlationId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(label: string, value: string): string {
  if (!UUID.test(value)) throw new TypeError(`${label} must be a UUID`);
  return value;
}

/**
 * Runs `fn` in a transaction whose row-level-security context is `actor`. The settings are
 * transaction-local, so they cannot leak to the next user of a pooled connection.
 */
export async function withActor<T>(
  db: Kysely<DB>,
  actor: Actor,
  fn: (trx: Transaction<DB>) => Promise<T>,
  options: ActorOptions = {},
): Promise<T> {
  const partnerId = actor.kind === 'seller' ? assertUuid('partnerId', actor.partnerId) : '';
  const customerId =
    actor.kind === 'buyer' && actor.customerId !== undefined
      ? assertUuid('customerId', actor.customerId)
      : '';
  return db.transaction().execute(async (trx) => {
    await sql`
      SELECT set_config('app.actor_kind', ${actor.kind}, true),
             set_config('app.partner_id', ${partnerId}, true),
             set_config('app.customer_id', ${customerId}, true),
             set_config('app.correlation_id', ${options.correlationId ?? ''}, true)
    `.execute(trx);
    return fn(trx);
  });
}
