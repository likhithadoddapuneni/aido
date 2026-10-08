import type { FastifyRequest } from 'fastify';
import { type AppContext, type Tx, runAs, runAsSystem } from '../../context.ts';
import { recordAudit } from '../../audit.ts';
import { HttpError, notFound } from '../../http/problem.ts';
import { requireActor, requireBuyer, type ApiActor } from '../../http/actor.ts';
import { authRuntime } from './tokens.ts';
import { revokeAllFor } from './sessions.ts';

const iso = (d: Date | string) => new Date(d).toISOString();

/** Provider sign-ins without a verified email get a placeholder address (see buyer.ts); never show it. */
const visibleEmail = (e: string | null) => (e && !e.endsWith('@users.invalid') ? e : null);

const customerDto = (c: {
  id: string;
  phone_e164: string | null;
  email: string | null;
  full_name: string | null;
  locale: string;
  created_at: Date | string;
}) => ({
  id: c.id,
  phone: c.phone_e164,
  email: visibleEmail(c.email),
  fullName: c.full_name,
  locale: c.locale as 'en' | 'ar',
  createdAt: iso(c.created_at),
});

function registeredBuyer(req: FastifyRequest): { customerId: string } {
  const a = requireBuyer(req, { registered: true });
  return { customerId: a.customerId as string };
}

/* ---------------- Profile ---------------- */

export async function getMe(ctx: AppContext, actor: ApiActor) {
  return runAsSystem(ctx, async (trx) => {
    if (actor.kind === 'buyer') {
      const customer = actor.customerId
        ? await trx
            .selectFrom('identity.customer')
            .selectAll()
            .where('id', '=', actor.customerId)
            .executeTakeFirst()
        : undefined;
      return {
        kind: 'buyer' as const,
        customer: customer ? customerDto(customer) : null,
        guestSessionId: actor.guestSessionId,
      };
    }
    if (actor.kind === 'seller') {
      const u = await trx
        .selectFrom('identity.seller_user')
        .selectAll()
        .where('id', '=', actor.sellerUserId)
        .executeTakeFirstOrThrow();
      return {
        kind: 'seller' as const,
        id: u.id,
        email: u.email,
        fullName: u.full_name,
        role: u.role,
        partnerId: u.partner_id,
        locationId: u.partner_location_id,
      };
    }
    const u = await trx
      .selectFrom('identity.ops_user')
      .selectAll()
      .where('id', '=', actor.opsUserId)
      .executeTakeFirstOrThrow();
    return { kind: 'ops' as const, id: u.id, email: u.email, fullName: u.full_name, role: u.role };
  });
}

export async function patchMe(
  ctx: AppContext,
  req: FastifyRequest,
  patch: { fullName?: string; locale?: 'en' | 'ar'; email?: string },
) {
  const { customerId } = registeredBuyer(req);
  try {
    const row = await runAsSystem(ctx, (trx) =>
      trx
        .updateTable('identity.customer')
        .set({
          ...(patch.fullName !== undefined ? { full_name: patch.fullName } : {}),
          ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
          ...(patch.email !== undefined ? { email: patch.email.toLowerCase() } : {}),
        })
        .where('id', '=', customerId)
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
    return customerDto(row);
  } catch (err) {
    if ((err as { code?: string }).code === '23505')
      throw new HttpError(409, 'email_in_use', 'That email is already in use.');
    throw err;
  }
}

/* ---------------- Devices (any signed-in principal) ---------------- */

type DeviceOwner = {
  customer_id: string | null;
  seller_user_id: string | null;
  ops_user_id: string | null;
};

function deviceOwner(a: ApiActor): DeviceOwner {
  switch (a.kind) {
    case 'buyer':
      if (!a.customerId)
        throw new HttpError(403, 'registration_required', 'Please sign in to continue.');
      return { customer_id: a.customerId, seller_user_id: null, ops_user_id: null };
    case 'seller':
      return { customer_id: null, seller_user_id: a.sellerUserId, ops_user_id: null };
    case 'ops':
      return { customer_id: null, seller_user_id: null, ops_user_id: a.opsUserId };
  }
}

export async function registerDevice(
  ctx: AppContext,
  actor: ApiActor,
  input: {
    platform: 'ios' | 'android' | 'web';
    pushToken: string;
    appVersion?: string | undefined;
  },
): Promise<void> {
  const owner = deviceOwner(actor);
  // A push token belongs to one device; if it moves to another account (shared phone) it moves with them.
  await runAsSystem(ctx, (trx) =>
    trx
      .insertInto('identity.device_token')
      .values({
        id: ctx.ids.uuid(),
        ...owner,
        platform: input.platform,
        push_token: input.pushToken,
        app_version: input.appVersion ?? null,
      })
      .onConflict((oc) =>
        oc.column('push_token').doUpdateSet({
          ...owner,
          platform: input.platform,
          app_version: input.appVersion ?? null,
          last_seen_at: new Date(ctx.clock.now()),
        }),
      )
      .execute(),
  );
}

export async function removeDevice(
  ctx: AppContext,
  actor: ApiActor,
  pushToken: string,
): Promise<void> {
  const owner = deviceOwner(actor);
  const key = (Object.keys(owner) as (keyof DeviceOwner)[]).find(
    (k) => owner[k] !== null,
  ) as keyof DeviceOwner;
  await runAsSystem(ctx, (trx) =>
    trx
      .deleteFrom('identity.device_token')
      .where('push_token', '=', pushToken)
      .where(key, '=', owner[key] as string)
      .execute(),
  );
}

/* ---------------- Consent ---------------- */

export type ConsentPurpose = 'terms' | 'marketing' | 'analytics';

export async function grantConsent(
  ctx: AppContext,
  req: FastifyRequest,
  purpose: ConsentPurpose,
  policyVersion: string,
) {
  const { customerId } = registeredBuyer(req);
  const now = new Date(ctx.clock.now());
  return runAs(ctx, req, async (trx) => {
    const active = await trx
      .selectFrom('identity.consent')
      .select(['id', 'policy_version', 'granted_at'])
      .where('customer_id', '=', customerId)
      .where('purpose', '=', purpose)
      .where('withdrawn_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (active?.policy_version === policyVersion) {
      return { purpose, policyVersion, grantedAt: iso(active.granted_at) };
    }
    // A new policy version replaces the old consent; the old row is kept as history.
    if (active)
      await trx
        .updateTable('identity.consent')
        .set({ withdrawn_at: now })
        .where('id', '=', active.id)
        .execute();
    await trx
      .insertInto('identity.consent')
      .values({ customer_id: customerId, purpose, policy_version: policyVersion, granted_at: now })
      .execute();
    return { purpose, policyVersion, grantedAt: iso(now) };
  });
}

export async function withdrawConsent(
  ctx: AppContext,
  req: FastifyRequest,
  purpose: ConsentPurpose,
): Promise<void> {
  const { customerId } = registeredBuyer(req);
  if (purpose === 'terms') {
    throw new HttpError(
      422,
      'terms_required',
      'The terms cannot be withdrawn while the account exists; delete the account instead.',
    );
  }
  await runAs(ctx, req, (trx) =>
    trx
      .updateTable('identity.consent')
      .set({ withdrawn_at: new Date(ctx.clock.now()) })
      .where('customer_id', '=', customerId)
      .where('purpose', '=', purpose)
      .where('withdrawn_at', 'is', null)
      .execute(),
  );
}

/* ---------------- Addresses ---------------- */

export interface AddressInput {
  label?: string | null | undefined;
  line1: string;
  line2?: string | null | undefined;
  area?: string | null | undefined;
  emirate: string;
  lat?: number | null | undefined;
  lng?: number | null | undefined;
  isDefault?: boolean | undefined;
}

const addressDto = (a: {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  area: string | null;
  emirate: string;
  lat: string | null;
  lng: string | null;
  is_default: boolean;
}) => ({
  id: a.id,
  label: a.label,
  line1: a.line1,
  line2: a.line2,
  area: a.area,
  emirate: a.emirate as 'Dubai',
  lat: a.lat === null ? null : Number(a.lat),
  lng: a.lng === null ? null : Number(a.lng),
  isDefault: a.is_default,
});

function assertGeo(i: AddressInput): void {
  if ((i.lat === null || i.lat === undefined) !== (i.lng === null || i.lng === undefined))
    throw new HttpError(
      422,
      'invalid_location',
      'Provide both latitude and longitude, or neither.',
    );
}

const addressColumns = (i: AddressInput) => ({
  label: i.label ?? null,
  line1: i.line1,
  line2: i.line2 ?? null,
  area: i.area ?? null,
  emirate: i.emirate,
  lat: i.lat ?? null,
  lng: i.lng ?? null,
});

async function clearDefault(trx: Tx, customerId: string): Promise<void> {
  await trx
    .updateTable('identity.customer_address')
    .set({ is_default: false })
    .where('customer_id', '=', customerId)
    .where('is_default', '=', true)
    .execute();
}

export async function listAddresses(ctx: AppContext, req: FastifyRequest) {
  const { customerId } = registeredBuyer(req);
  const rows = await runAs(ctx, req, (trx) =>
    trx
      .selectFrom('identity.customer_address')
      .selectAll()
      .where('customer_id', '=', customerId)
      .orderBy('created_at')
      .execute(),
  );
  return rows.map(addressDto);
}

export async function createAddress(ctx: AppContext, req: FastifyRequest, input: AddressInput) {
  const { customerId } = registeredBuyer(req);
  assertGeo(input);
  const row = await runAs(ctx, req, async (trx) => {
    const count = await trx
      .selectFrom('identity.customer_address')
      .select((e) => e.fn.countAll<string>().as('n'))
      .where('customer_id', '=', customerId)
      .executeTakeFirstOrThrow();
    const makeDefault = input.isDefault === true || Number(count.n) === 0;
    if (makeDefault) await clearDefault(trx, customerId);
    return trx
      .insertInto('identity.customer_address')
      .values({
        id: ctx.ids.uuid(),
        customer_id: customerId,
        ...addressColumns(input),
        is_default: makeDefault,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  });
  return addressDto(row);
}

export async function updateAddress(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
  input: AddressInput,
) {
  const { customerId } = registeredBuyer(req);
  assertGeo(input);
  const row = await runAs(ctx, req, async (trx) => {
    if (input.isDefault === true) await clearDefault(trx, customerId);
    return trx
      .updateTable('identity.customer_address')
      .set({
        ...addressColumns(input),
        ...(input.isDefault !== undefined ? { is_default: input.isDefault } : {}),
      })
      .where('id', '=', id)
      .where('customer_id', '=', customerId)
      .returningAll()
      .executeTakeFirst();
  });
  if (!row) throw notFound('Address');
  return addressDto(row);
}

export async function deleteAddress(
  ctx: AppContext,
  req: FastifyRequest,
  id: string,
): Promise<void> {
  const { customerId } = registeredBuyer(req);
  const res = await runAs(ctx, req, (trx) =>
    trx
      .deleteFrom('identity.customer_address')
      .where('id', '=', id)
      .where('customer_id', '=', customerId)
      .executeTakeFirst(),
  );
  if (res.numDeletedRows === 0n) throw notFound('Address');
}

/* ---------------- Erasure and export (ADR-025) ---------------- */

/**
 * Anonymise the account: contact details and everything derived from them go; rows that other
 * records reference (orders, ledger, settlement) keep the customer's id, which now points at nothing
 * personal. Delivery details already copied onto an order are retained for fulfilment and tax.
 */
export async function eraseAccount(ctx: AppContext, req: FastifyRequest): Promise<void> {
  const { customerId } = registeredBuyer(req);
  const actor = requireActor(req);
  const now = new Date(ctx.clock.now());
  await runAsSystem(ctx, async (trx) => {
    const c = await trx
      .selectFrom('identity.customer')
      .select(['phone_e164', 'status'])
      .where('id', '=', customerId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (c.status === 'Erased') return;

    if (c.phone_e164) {
      const destination = authRuntime(ctx.config).secrets.mac('phone', c.phone_e164);
      await trx
        .deleteFrom('identity.otp_challenge')
        .where('destination_hash', '=', destination)
        .execute();
    }
    await trx
      .deleteFrom('identity.customer_address')
      .where('customer_id', '=', customerId)
      .execute();
    await trx.deleteFrom('identity.device_token').where('customer_id', '=', customerId).execute();
    await trx.deleteFrom('identity.oauth_identity').where('customer_id', '=', customerId).execute();
    await trx.deleteFrom('identity.guest_session').where('customer_id', '=', customerId).execute();
    await trx
      .updateTable('recommendation.project')
      .set({ media_keys: '[]' })
      .where('customer_id', '=', customerId)
      .execute();
    await revokeAllFor(ctx, trx, { kind: 'buyer', id: customerId });
    await trx
      .updateTable('identity.customer')
      .set({ status: 'Erased', erased_at: now, phone_e164: null, email: null, full_name: null })
      .where('id', '=', customerId)
      .execute();
    await recordAudit(trx, {
      entityType: 'customer',
      entityId: customerId,
      from: 'Active',
      to: 'Erased',
      actor,
      reason: 'erasure requested by the customer',
    });
  });
}

export async function exportData(ctx: AppContext, req: FastifyRequest) {
  const { customerId } = registeredBuyer(req);
  return runAs(ctx, req, async (trx) => {
    const customer = await trx
      .selectFrom('identity.customer')
      .selectAll()
      .where('id', '=', customerId)
      .executeTakeFirstOrThrow();
    const [addresses, consents, devices, projects, orders, viewings] = await Promise.all([
      trx
        .selectFrom('identity.customer_address')
        .selectAll()
        .where('customer_id', '=', customerId)
        .orderBy('created_at')
        .execute(),
      trx
        .selectFrom('identity.consent')
        .selectAll()
        .where('customer_id', '=', customerId)
        .orderBy('granted_at')
        .execute(),
      trx
        .selectFrom('identity.device_token')
        .select(['platform', 'app_version', 'last_seen_at'])
        .where('customer_id', '=', customerId)
        .execute(),
      trx
        .selectFrom('recommendation.project')
        .select(['id', 'path_id', 'state', 'spec'])
        .where('customer_id', '=', customerId)
        .orderBy('created_at')
        .execute(),
      trx
        .selectFrom('commerce.master_order')
        .select(['id', 'gross_fils', 'paid_fils', 'placed_at'])
        .where('customer_id', '=', customerId)
        .orderBy('placed_at')
        .execute(),
      trx
        .selectFrom('viewing.viewing_request')
        .select(['id', 'state', 'created_at'])
        .where('customer_id', '=', customerId)
        .orderBy('created_at')
        .execute(),
    ]);
    return {
      exportedAt: iso(new Date(ctx.clock.now())),
      customer: customerDto(customer),
      addresses: addresses.map(addressDto),
      consents: consents.map((c) => ({
        purpose: c.purpose as ConsentPurpose,
        policyVersion: c.policy_version,
        grantedAt: iso(c.granted_at),
        withdrawnAt: c.withdrawn_at ? iso(c.withdrawn_at) : null,
      })),
      devices: devices.map((d) => ({
        platform: d.platform,
        appVersion: d.app_version,
        lastSeenAt: iso(d.last_seen_at),
      })),
      projects: projects.map((p) => ({
        id: p.id,
        pathId: p.path_id,
        state: p.state,
        spec: p.spec,
      })),
      orders: orders.map((o) => ({
        id: o.id,
        grossFils: Number(o.gross_fils),
        paidFils: Number(o.paid_fils),
        placedAt: iso(o.placed_at),
      })),
      viewings: viewings.map((v) => ({ id: v.id, state: v.state, createdAt: iso(v.created_at) })),
    };
  });
}
