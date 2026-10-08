/**
 * What each ops role may see and do. This mirrors the API's own authorisation matrix
 * (`apps/api/src/modules/ops/guard.ts`) so the console never offers a button the server will refuse.
 * It is a convenience, not a control: the API enforces every one of these again.
 */
export const OPS_ROLES = ['ops_admin', 'ops_catalogue', 'ops_support', 'ops_finance'] as const;
export type OpsRole = (typeof OPS_ROLES)[number];

export type Capability =
  | 'overview'
  | 'partners.read'
  | 'partners.write'
  | 'partners.activate'
  | 'products.read'
  | 'products.write'
  | 'maps.read'
  | 'maps.write'
  | 'desk.read'
  | 'desk.notes'
  | 'issues'
  | 'settlement.read'
  | 'settlement.approve'
  | 'staff'
  | 'audit'
  | 'flags';

const MATRIX: Record<Capability, readonly OpsRole[]> = {
  overview: ['ops_admin', 'ops_catalogue', 'ops_support', 'ops_finance'],
  'partners.read': ['ops_admin', 'ops_catalogue', 'ops_support', 'ops_finance'],
  'partners.write': ['ops_admin', 'ops_catalogue'],
  'partners.activate': ['ops_admin'],
  'products.read': ['ops_admin', 'ops_catalogue'],
  'products.write': ['ops_admin', 'ops_catalogue'],
  'maps.read': ['ops_admin', 'ops_catalogue'],
  'maps.write': ['ops_admin'],
  'desk.read': ['ops_admin', 'ops_support', 'ops_finance'],
  'desk.notes': ['ops_admin', 'ops_support'],
  issues: ['ops_admin', 'ops_support'],
  'settlement.read': ['ops_admin', 'ops_finance'],
  // Four-eyes approval and payout are finance's alone: not even an administrator may approve money.
  'settlement.approve': ['ops_finance'],
  staff: ['ops_admin'],
  audit: ['ops_admin', 'ops_support'],
  flags: ['ops_admin'],
};

export const can = (role: string | undefined, cap: Capability): boolean =>
  role !== undefined && (MATRIX[cap] as readonly string[]).includes(role);

export const isOpsRole = (r: string): r is OpsRole => (OPS_ROLES as readonly string[]).includes(r);
