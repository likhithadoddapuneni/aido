import type { Checkout } from '@aidooi/contracts';

export interface StateFacts {
  readonly validationState: 'Validation Pending' | 'Validated' | 'Rebuild Required';
  readonly reservationState: 'Active' | 'Converted' | 'Released' | 'Expired' | null;
  readonly reservationExpired: boolean;
  readonly hasOrder: boolean;
  readonly pendingConfirmations: number;
  readonly anyPriceChanged: boolean;
  readonly anyBlocked: boolean;
  readonly paymentAwaitingAction: boolean;
}

/**
 * The single place a checkout's buyer-facing state is decided, from facts alone. Pure so every
 * combination can be tested without a database.
 */
export function checkoutState(f: StateFacts): Checkout['state'] {
  if (f.hasOrder) return 'Paid';
  if (f.validationState === 'Rebuild Required' || f.anyBlocked) return 'Rebuild Required';
  if (f.reservationState === 'Expired' || f.reservationState === 'Released' || f.reservationExpired)
    return 'Expired';
  if (f.pendingConfirmations > 0) return 'Awaiting Seller Confirmation';
  if (f.anyPriceChanged) return 'Awaiting Price Approval';
  if (f.paymentAwaitingAction) return 'Payment Requires Action';
  return 'Ready to Pay';
}
