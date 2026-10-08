import type { FastifyRequest } from 'fastify';
import type { Actor as DbActor } from '@aidooi/db';
import { forbidden, unauthorized } from './problem.ts';

export type SellerRole = 'seller_owner' | 'seller_manager' | 'seller_staff';
export type OpsRole = 'ops_admin' | 'ops_catalogue' | 'ops_support' | 'ops_finance';

/** Who is making a request, resolved by the `Authenticator`. Never constructed from request bodies. */
export type ApiActor =
  /** A buyer. A guest has a session but no customer row yet; they may browse and profile only. */
  | {
      readonly kind: 'buyer';
      readonly customerId: string | null;
      readonly guestSessionId: string | null;
    }
  | {
      readonly kind: 'seller';
      readonly partnerId: string;
      readonly sellerUserId: string;
      readonly role: SellerRole;
      /** When set, the user works at one showroom only. */
      readonly locationId: string | null;
    }
  | { readonly kind: 'ops'; readonly opsUserId: string; readonly role: OpsRole };

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the authentication hook; `null` for anonymous requests. */
    actor: ApiActor | null;
  }
}

export function requireActor(req: FastifyRequest): ApiActor {
  if (!req.actor) throw unauthorized();
  return req.actor;
}

export function requireBuyer(req: FastifyRequest, opts: { registered?: boolean } = {}) {
  const a = requireActor(req);
  if (a.kind !== 'buyer') throw forbidden('This action is for buyers.');
  if (opts.registered && !a.customerId) {
    // The client resumes the pending action after registering; nothing is lost (gap #13).
    throw Object.assign(forbidden('Please sign in to continue.'), {
      code: 'registration_required',
      status: 403,
    });
  }
  return a;
}

export function requireSeller(req: FastifyRequest, roles?: readonly SellerRole[]) {
  const a = requireActor(req);
  if (a.kind !== 'seller') throw forbidden('This action is for sellers.');
  if (roles && !roles.includes(a.role)) throw forbidden('Your role cannot do this.');
  return a;
}

export function requireOps(req: FastifyRequest, roles?: readonly OpsRole[]) {
  const a = requireActor(req);
  if (a.kind !== 'ops') throw forbidden('This action is for AIDOOi operations.');
  if (roles && !roles.includes(a.role) && a.role !== 'ops_admin')
    throw forbidden('Your role cannot do this.');
  return a;
}

/** The row-level-security context for an API actor. */
export function toDbActor(a: ApiActor): DbActor {
  switch (a.kind) {
    case 'buyer':
      return a.customerId ? { kind: 'buyer', customerId: a.customerId } : { kind: 'buyer' };
    case 'seller':
      return { kind: 'seller', partnerId: a.partnerId };
    case 'ops':
      return { kind: 'ops' };
  }
}

/** Short, non-PII identification for audit rows. The type vocabulary is the one `audit.event` enforces. */
export function auditActor(a: ApiActor | 'system'): { type: string; id: string | null } {
  if (a === 'system') return { type: 'system', id: null };
  switch (a.kind) {
    case 'buyer':
      return a.customerId
        ? { type: 'customer', id: a.customerId }
        : { type: 'guest', id: a.guestSessionId };
    case 'seller':
      return { type: 'seller_user', id: a.sellerUserId };
    case 'ops':
      return { type: 'ops_user', id: a.opsUserId };
  }
}
