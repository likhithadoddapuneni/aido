import type { Kysely, Transaction } from 'kysely';
import type { DB } from '@aidooi/db';
import type { ApiActor, OpsRole, SellerRole } from '../../http/actor.ts';

type Q = Kysely<DB> | Transaction<DB>;

/** Who a session belongs to. The id is the principal's row id in `identity`. */
export type Subject =
  | { readonly kind: 'buyer'; readonly id: string }
  | { readonly kind: 'seller'; readonly id: string }
  | { readonly kind: 'ops'; readonly id: string };

/**
 * The principal as the database sees it *right now*. Tokens only name a subject; whether that
 * subject may still act is decided here on every request, so disabling a user, erasing a customer
 * or deactivating a partner takes effect immediately rather than when a token expires.
 */
export async function resolveActor(q: Q, s: Subject): Promise<ApiActor | null> {
  switch (s.kind) {
    case 'buyer': {
      const c = await q
        .selectFrom('identity.customer')
        .select('id')
        .where('id', '=', s.id)
        .where('status', '=', 'Active')
        .executeTakeFirst();
      return c ? { kind: 'buyer', customerId: c.id, guestSessionId: null } : null;
    }
    case 'seller': {
      const u = await q
        .selectFrom('identity.seller_user as u')
        .innerJoin('catalogue.partner as p', 'p.id', 'u.partner_id')
        .select(['u.id', 'u.role', 'u.partner_id', 'u.partner_location_id'])
        .where('u.id', '=', s.id)
        .where('u.status', '=', 'Active')
        .where('p.status', '=', 'Active')
        .executeTakeFirst();
      return u
        ? {
            kind: 'seller',
            partnerId: u.partner_id,
            sellerUserId: u.id,
            role: u.role as SellerRole,
            locationId: u.partner_location_id,
          }
        : null;
    }
    case 'ops': {
      const u = await q
        .selectFrom('identity.ops_user')
        .select(['id', 'role'])
        .where('id', '=', s.id)
        .where('status', '=', 'Active')
        .executeTakeFirst();
      return u ? { kind: 'ops', opsUserId: u.id, role: u.role as OpsRole } : null;
    }
  }
}
