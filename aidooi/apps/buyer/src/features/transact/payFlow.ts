import { ApiProblem, NetworkError } from '@aidooi/api-client';

/** What the pay screen should do about an error from `POST /checkout/{id}/pay`. */
export type PayErrorAction =
  /** The card was refused or the capture failed. A different card is a NEW payment intent. */
  | { kind: 'declined' }
  /** Another payment for this checkout is in flight: wait and look. */
  | { kind: 'in-progress' }
  /** The checkout itself changed (price, stock, window, seller): go back to it and show its state. */
  | { kind: 'checkout-changed'; resetKey: true }
  /** This attempt is closed (voided, superseded): start a fresh intent. */
  | { kind: 'restart'; resetKey: true }
  /** The outcome is unknown or the server could not take it: retry with the SAME key. */
  | { kind: 'retry' }
  /** The buyer must sign in (guest) — resume after. */
  | { kind: 'sign-in' }
  | { kind: 'error' };

const CHECKOUT_CHANGED = new Set([
  'price_approval_required',
  'awaiting_seller_confirmation',
  'reservation_expired',
  'seller_validation_failed',
  'checkout_changed',
  'not_validated',
  'total_changed',
  'checkout_blocked',
  'order_could_not_be_placed',
]);

export function classifyPayError(e: unknown): PayErrorAction {
  if (e instanceof NetworkError) return { kind: 'retry' };
  if (!(e instanceof ApiProblem)) return { kind: 'error' };
  if (e.code === 'registration_required') return { kind: 'sign-in' };
  if (e.status === 402 || e.code === 'payment_declined' || e.code === 'payment_capture_failed') {
    return { kind: 'declined' };
  }
  if (e.code === 'payment_in_progress' || e.code === 'request_in_progress') {
    return { kind: 'in-progress' };
  }
  if (CHECKOUT_CHANGED.has(e.code)) return { kind: 'checkout-changed', resetKey: true };
  if (e.code === 'payment_closed' || e.code === 'payment_superseded') {
    return { kind: 'restart', resetKey: true };
  }
  if (e.retryable) return { kind: 'retry' };
  return { kind: 'error' };
}

/**
 * One idempotency key per *intent to pay*. It is created on first use and kept across retries — so a
 * timeout whose outcome is unknown can never charge twice — and dropped only when the attempt is over
 * (declined, paid, closed) so the next attempt is genuinely new.
 */
export function createIntentKey(newKey: () => string) {
  let key: string | null = null;
  return {
    current(): string {
      key ??= newKey();
      return key;
    },
    reset(): void {
      key = null;
    },
    peek: (): string | null => key,
  };
}
export type IntentKey = ReturnType<typeof createIntentKey>;
