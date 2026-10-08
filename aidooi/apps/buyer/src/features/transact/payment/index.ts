import type * as MockModule from './mock.ts';
import type { DemoPayments } from './mock.ts';
import type { PaymentSheet } from './PaymentSheet.ts';
import { providerPaymentSheet } from './provider.ts';

export * from './PaymentSheet.ts';
export type { DemoPayments, DemoScenario } from './mock.ts';

/**
 * The demo payments, or `null`. Two independent conditions must both hold: a development build
 * (`__DEV__`) AND an explicit opt-in. In a production bundle both are constants, so Metro folds this
 * branch away and the `require` — and the test tokens — are not in the bundle at all.
 */
export function loadDemoPayments(): DemoPayments | null {
  if (__DEV__ && process.env['EXPO_PUBLIC_ENABLE_MOCK_PAYMENTS'] === 'true') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a conditional require is what lets the bundler drop the file
    return (require('./mock.ts') as typeof MockModule).demoPayments;
  }
  return null;
}

/** What the pay screens use: the demo sheet when explicitly enabled in development, otherwise the provider's. */
export function resolvePaymentSheet(): PaymentSheet {
  return loadDemoPayments()?.sheet ?? providerPaymentSheet;
}
