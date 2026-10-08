import { randomUUID } from 'node:crypto';
import type { ApiActor, SellerRole } from '../../src/http/actor.ts';
import { buyer, ops, seller, type Harness } from './harness.ts';

export interface TestSeller {
  readonly actor: ApiActor;
  readonly partnerId: string;
  readonly userId: string;
  readonly locationId: string;
}

/** A real, Active seller_user of a seeded partner (so audit, confirmation and team rows all line up). */
export async function sellerOf(
  h: Harness,
  role: SellerRole = 'seller_owner',
  code = 'PRT-001',
): Promise<TestSeller> {
  const partnerId = h.seeded!.partners.get(code)!;
  const userId = randomUUID();
  await h.admin
    .insertInto('identity.seller_user')
    .values({
      id: userId,
      partner_id: partnerId,
      email: `${userId}@seller.test`,
      full_name: 'Test Seller',
      role,
      status: 'Active',
    })
    .execute();
  return {
    actor: seller(partnerId, userId, role),
    partnerId,
    userId,
    locationId: h.seeded!.locations.get(partnerId)!,
  };
}

export interface Res {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
  text: string;
  headers: Record<string, unknown>;
}

export async function api(
  h: Harness,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  actor: ApiActor | null,
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<Res> {
  const res = await h.app.inject({
    method,
    url,
    headers: h.as(actor, extra),
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  let json: unknown = null;
  try {
    json = res.body ? JSON.parse(res.body) : null;
  } catch {
    /* not JSON (csv) */
  }
  return { status: res.statusCode, json, text: res.body, headers: res.headers };
}

export const aBuyer = () => buyer('c0000000-0000-4000-8000-000000000001');
export const anOps = () => ops('d0000000-0000-4000-8000-000000000001');

/** An offer of the seller's, found in the seeded catalogue. */
export async function anOffer(h: Harness, partnerId: string, opts: { stockAtLeast?: number } = {}) {
  return h.admin
    .selectFrom('catalogue.seller_offer')
    .selectAll()
    .where('partner_id', '=', partnerId)
    .where('stock_qty', '>=', opts.stockAtLeast ?? 3)
    .where('offer_status', '=', 'Active')
    .orderBy('id')
    .executeTakeFirstOrThrow();
}
