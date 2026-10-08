export type SellerRole = 'seller_owner' | 'seller_manager' | 'seller_staff';

export const isSellerRole = (r: string): r is SellerRole =>
  r === 'seller_owner' || r === 'seller_manager' || r === 'seller_staff';

export interface Capabilities {
  readonly respondToTasks: boolean;
  readonly scanVisitors: boolean;
  readonly advanceOrders: boolean;
  readonly respondToIssues: boolean;
  readonly editStock: boolean;
  /** Prices are commercial decisions: managers and owners only. The API enforces it too. */
  readonly editPrice: boolean;
}

/** What the *interface* offers each role. The server is the authority; this only avoids showing what would be refused. */
export function capabilitiesOf(role: SellerRole): Capabilities {
  const commercial = role !== 'seller_staff';
  return {
    respondToTasks: true,
    scanVisitors: true,
    advanceOrders: true,
    respondToIssues: true,
    editStock: true,
    editPrice: commercial,
  };
}

/** A role string from the server we do not recognise gets the least privilege. */
export const capabilitiesForClaim = (role: string): Capabilities =>
  capabilitiesOf(isSellerRole(role) ? role : 'seller_staff');
