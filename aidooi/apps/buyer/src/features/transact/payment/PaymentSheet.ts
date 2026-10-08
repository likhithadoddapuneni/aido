/**
 * The only seam between the app and a card processor. A real implementation presents the provider's native
 * sheet (cards, Apple Pay, Google Pay, 3-D Secure set-up) and returns the **opaque token** it produces.
 * Card numbers never exist in this app's memory, logs or requests.
 */
export interface PaymentSheet {
  getPaymentToken(): Promise<string>;
}

/** The buyer closed the provider's sheet without paying. Not an error to report; just stop. */
export class PaymentCancelled extends Error {
  constructor() {
    super('Payment was cancelled');
    this.name = 'PaymentCancelled';
  }
}

/** No payment provider is wired into this build. Shown as "payments are not available yet", never a crash. */
export class PaymentNotConfigured extends Error {
  constructor() {
    super('No payment provider is configured in this build');
    this.name = 'PaymentNotConfigured';
  }
}
