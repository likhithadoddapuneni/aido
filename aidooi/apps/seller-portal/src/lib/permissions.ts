/**
 * What each seller role may do in the UI. The API enforces the same rules (and is the authority);
 * this only decides what to *show*, so a person never sees a button that would be refused.
 */
export type Role = 'seller_owner' | 'seller_manager' | 'seller_staff';

export type Action =
  | 'editPrice'
  | 'editStock'
  | 'createOffer'
  | 'submitProduct'
  | 'import'
  | 'editProfile'
  | 'manageLocations'
  | 'viewStatements'
  | 'manageTeam'
  | 'viewPerformance'
  | 'advanceOrders'
  | 'respondTasks';

const MANAGE: readonly Action[] = [
  'editPrice',
  'createOffer',
  'submitProduct',
  'import',
  'editProfile',
  'manageLocations',
  'viewStatements',
  'viewPerformance',
];
const FLOOR: readonly Action[] = ['editStock', 'advanceOrders', 'respondTasks'];

const ALLOWED: Readonly<Record<Role, ReadonlySet<Action>>> = {
  seller_owner: new Set<Action>([...MANAGE, ...FLOOR, 'manageTeam']),
  seller_manager: new Set<Action>([...MANAGE, ...FLOOR]),
  seller_staff: new Set<Action>(FLOOR),
};

export const can = (role: Role | undefined, action: Action): boolean =>
  role !== undefined && ALLOWED[role].has(action);

export const isRole = (v: string): v is Role => v in ALLOWED;
