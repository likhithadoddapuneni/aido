import type { FastifyRequest } from 'fastify';
import { requireOps, type OpsRole } from '../../http/actor.ts';

/**
 * Who may do what in the back office. `ops_admin` passes every check (see `requireOps`); each list
 * names the *other* roles allowed. Kept in one place so the authorisation matrix is reviewable.
 */
export const ROLES = {
  /** Partners, products and compatibility maps are read by the catalogue desk. */
  catalogueRead: ['ops_catalogue'],
  catalogueWrite: ['ops_catalogue'],
  /** Orders, customers, viewings and the audit trail are read by support (finance reads orders). */
  deskRead: ['ops_support', 'ops_finance'],
  deskWrite: ['ops_support'],
  auditRead: ['ops_support'],
  /** Only administrators: activation, maps, staff, flags, merge, MFA reset. */
  adminOnly: [],
  anyOps: ['ops_catalogue', 'ops_support', 'ops_finance'],
} as const satisfies Record<string, readonly OpsRole[]>;

export const guard = (req: FastifyRequest, roles: readonly OpsRole[]) => requireOps(req, roles);
