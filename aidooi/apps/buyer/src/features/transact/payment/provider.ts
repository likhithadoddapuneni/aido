import { PaymentNotConfigured, type PaymentSheet } from './PaymentSheet.ts';

/**
 * ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
 * │  PAYMENT PROVIDER SLOT                                                                      │
 * │  When a provider is chosen, replace the body of `getPaymentToken` with its SDK call         │
 * │  (present the native sheet; return the token it gives you; throw `PaymentCancelled` if the  │
 * │  buyer dismisses it). Nothing else in the app changes: `PayScreen` and the viewing deposit  │
 * │  both go through this one function, and the server already speaks tokens.                   │
 * └─────────────────────────────────────────────────────────────────────────────────────────────┘
 */
export const providerPaymentSheet: PaymentSheet = {
  getPaymentToken: async () => {
    throw new PaymentNotConfigured();
  },
};
