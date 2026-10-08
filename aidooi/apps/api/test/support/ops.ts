import { randomUUID } from 'node:crypto';
import type { ApiActor, OpsRole } from '../../src/http/actor.ts';
import { call, type Json } from './auth-helpers.ts';
import type { Harness } from './harness.ts';

/** An ops user who exists in the database (so audit, notes and verification can reference them). */
export async function opsActor(
  h: Harness,
  role: OpsRole = 'ops_admin',
): Promise<ApiActor & { kind: 'ops' }> {
  const id = randomUUID();
  await h.admin
    .insertInto('identity.ops_user')
    .values({ id, email: `${role}-${id.slice(0, 8)}@aidooi.test`, full_name: `Test ${role}`, role })
    .execute();
  return { kind: 'ops', opsUserId: id, role };
}

export interface Api {
  get(url: string): Promise<{ status: number; json: Json }>;
  post(url: string, body?: unknown): Promise<{ status: number; json: Json }>;
  patch(url: string, body: unknown): Promise<{ status: number; json: Json }>;
  put(url: string, body: unknown): Promise<{ status: number; json: Json }>;
}

/** Calls the real HTTP surface as one actor. */
export function as(h: Harness, actor: ApiActor | null): Api {
  const headers = h.as(actor);
  const go = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, body?: unknown) =>
    call(h, method, url, { headers, ...(body !== undefined ? { body } : {}) });
  return {
    get: (u) => go('GET', u),
    post: (u, b) => go('POST', u, b ?? {}),
    patch: (u, b) => go('PATCH', u, b),
    put: (u, b) => go('PUT', u, b),
  };
}

export const NEW_PARTNER = {
  legalName: 'Palm Interiors LLC',
  tradeName: 'Palm Interiors',
  commissionBps: 1500,
  afterSalesTerms: 'Returns within 7 days if unused.',
  contactEmail: 'owner@palm.test',
};
