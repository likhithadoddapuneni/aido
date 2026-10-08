import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type {
  CreateLocationBodySchema,
  LocationSchema,
  SellerProfileSchema,
  UpdateLocationBodySchema,
  UpdateProfileBodySchema,
} from '@aidooi/contracts';
import { recordAudit } from '../../audit.ts';
import { runAs, runAsSystem, type AppContext } from '../../context.ts';
import { conflict, notFound } from '../../http/problem.ts';
import { requireSeller } from '../../http/actor.ts';
import { requireManager } from './common.ts';

type Profile = z.infer<typeof SellerProfileSchema>;
type Location = z.infer<typeof LocationSchema>;

export async function getProfile(ctx: AppContext, req: FastifyRequest): Promise<Profile> {
  const seller = requireSeller(req);
  return runAs(ctx, req, async (trx) => {
    const p = await trx
      .selectFrom('catalogue.partner')
      .selectAll()
      .where('id', '=', seller.partnerId)
      .executeTakeFirst();
    if (!p) throw notFound('Partner');
    return {
      code: p.code,
      tradeName: p.trade_name,
      legalName: p.legal_name,
      status: p.status,
      contactEmail: p.contact_email,
      contactPhone: p.contact_phone,
      afterSalesTerms: p.after_sales_terms,
    };
  });
}

/** Only the four fields a seller owns. Commission, status, code and legal identity are never in the SET list. */
export async function updateProfile(
  ctx: AppContext,
  req: FastifyRequest,
  body: z.infer<typeof UpdateProfileBodySchema>,
): Promise<Profile> {
  const seller = requireManager(req);
  await runAs(ctx, req, async (trx) => {
    const before = await trx
      .selectFrom('catalogue.partner')
      .select(['trade_name', 'contact_email', 'contact_phone', 'after_sales_terms'])
      .where('id', '=', seller.partnerId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const set = {
      ...(body.tradeName !== undefined ? { trade_name: body.tradeName } : {}),
      ...(body.contactEmail !== undefined ? { contact_email: body.contactEmail } : {}),
      ...(body.contactPhone !== undefined ? { contact_phone: body.contactPhone } : {}),
      ...(body.afterSalesTerms !== undefined ? { after_sales_terms: body.afterSalesTerms } : {}),
    };
    const after = await trx
      .updateTable('catalogue.partner')
      .set(set)
      .where('id', '=', seller.partnerId)
      .returning(['trade_name', 'contact_email', 'contact_phone', 'after_sales_terms'])
      .executeTakeFirstOrThrow();
    await recordAudit(trx, {
      entityType: 'partner',
      entityId: seller.partnerId,
      from: null,
      to: null,
      actor: req.actor!,
      reason: 'profile updated',
      data: { before, after },
    });
  });
  return getProfile(ctx, req);
}

/* ---------------- Showrooms ---------------- */

const toLocation = (l: {
  id: string;
  name: string;
  address: string;
  emirate: string;
  lat: string | null;
  lng: string | null;
  opening_hours: unknown;
  status: string;
}): Location => ({
  id: l.id,
  name: l.name,
  address: l.address,
  emirate: l.emirate as Location['emirate'],
  lat: l.lat === null ? null : Number(l.lat),
  lng: l.lng === null ? null : Number(l.lng),
  openingHours: (l.opening_hours ?? {}) as Location['openingHours'],
  status: l.status as Location['status'],
});

export async function listLocations(ctx: AppContext, req: FastifyRequest): Promise<Location[]> {
  const seller = requireSeller(req);
  return runAs(ctx, req, async (trx) =>
    (
      await trx
        .selectFrom('catalogue.partner_location')
        .selectAll()
        .where('partner_id', '=', seller.partnerId)
        .orderBy('created_at')
        .execute()
    ).map(toLocation),
  );
}

export async function createLocation(
  ctx: AppContext,
  req: FastifyRequest,
  body: z.infer<typeof CreateLocationBodySchema>,
): Promise<Location> {
  const seller = requireManager(req);
  return runAs(ctx, req, async (trx) => {
    const row = await trx
      .insertInto('catalogue.partner_location')
      .values({
        partner_id: seller.partnerId,
        name: body.name,
        address: body.address,
        emirate: body.emirate,
        lat: body.lat ?? null,
        lng: body.lng ?? null,
        opening_hours: JSON.stringify(body.openingHours),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await recordAudit(trx, {
      entityType: 'partner_location',
      entityId: row.id,
      from: null,
      to: 'Active',
      actor: req.actor!,
    });
    return toLocation(row);
  });
}

export async function updateLocation(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
  body: z.infer<typeof UpdateLocationBodySchema>,
): Promise<Location> {
  const seller = requireManager(req);
  if (body.status === 'Inactive') await assertLocationUnused(ctx, seller.partnerId, id);
  return runAs(ctx, req, async (trx) => {
    const before = await trx
      .selectFrom('catalogue.partner_location')
      .selectAll()
      .where('id', '=', id)
      .where('partner_id', '=', seller.partnerId)
      .forUpdate()
      .executeTakeFirst();
    if (!before) throw notFound('Location');
    const lat = body.lat !== undefined ? body.lat : before.lat === null ? null : Number(before.lat);
    const lng = body.lng !== undefined ? body.lng : before.lng === null ? null : Number(before.lng);
    if ((lat === null) !== (lng === null))
      throw conflict('location_geo_incomplete', 'Give both lat and lng, or neither.');
    const row = await trx
      .updateTable('catalogue.partner_location')
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.address !== undefined ? { address: body.address } : {}),
        ...(body.emirate !== undefined ? { emirate: body.emirate } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.openingHours !== undefined
          ? { opening_hours: JSON.stringify(body.openingHours) }
          : {}),
        lat,
        lng,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await recordAudit(trx, {
      entityType: 'partner_location',
      entityId: id,
      from: before.status,
      to: row.status,
      actor: req.actor!,
      data: {
        before: { name: before.name, address: before.address, status: before.status },
        after: { name: row.name, address: row.address, status: row.status },
      },
    });
    return toLocation(row);
  });
}

/**
 * A showroom with live offers or an upcoming viewing cannot be closed: buyers have been promised
 * somewhere to go. The viewing check reads buyer-owned rows a seller cannot see, so it runs as the platform.
 */
async function assertLocationUnused(
  ctx: AppContext,
  partnerId: string,
  locationId: string,
): Promise<void> {
  const { offers, viewings } = await runAsSystem(ctx, async (trx) => {
    const o = await trx
      .selectFrom('catalogue.seller_offer')
      .select((e) => e.fn.countAll<string>().as('n'))
      .where('partner_location_id', '=', locationId)
      .where('partner_id', '=', partnerId)
      .where('offer_status', '=', 'Active')
      .executeTakeFirstOrThrow();
    const v = await trx
      .selectFrom('viewing.viewing_stop as s')
      .innerJoin('viewing.viewing_request as r', 'r.id', 's.viewing_request_id')
      .select((e) => e.fn.countAll<string>().as('n'))
      .where('s.partner_location_id', '=', locationId)
      .where('r.state', 'in', ['Awaiting Seller Confirmation', 'Awaiting Deposit', 'Confirmed'])
      .executeTakeFirstOrThrow();
    return { offers: Number(o.n), viewings: Number(v.n) };
  });
  if (offers > 0)
    throw conflict(
      'location_has_live_offers',
      `${offers} active offer(s) are listed at this showroom. Move or deactivate them first.`,
    );
  if (viewings > 0)
    throw conflict(
      'location_has_viewings',
      `${viewings} buyer viewing(s) are booked at this showroom.`,
    );
}
