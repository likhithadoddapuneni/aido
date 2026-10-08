import type { PaymentSheet } from './PaymentSheet.ts';

/**
 * Demo scenarios for development and demos ONLY. These are the mock gateway's well-known test tokens:
 * with the mock gateway live anyone holding them can order for free, which is why this file must never
 * reach a production bundle — see `./index.ts`, which only `require`s it behind `__DEV__` AND an explicit
 * flag, and the test that fails if a production build contains it.
 */
export interface DemoScenario {
  readonly id: string;
  readonly token: string;
}

export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  { id: 'ok', token: 'tok_ok' },
  { id: 'decline', token: 'tok_decline' },
  { id: 'threeDs', token: 'tok_3ds' },
  { id: 'flaky', token: 'tok_flaky_once' },
];

export interface DemoPayments {
  readonly scenarios: readonly DemoScenario[];
  select(id: string): void;
  selected(): string;
  readonly sheet: PaymentSheet;
}

export function createDemoPayments(): DemoPayments {
  let current = 'ok';
  return {
    scenarios: DEMO_SCENARIOS,
    select: (id) => void (current = DEMO_SCENARIOS.some((s) => s.id === id) ? id : current),
    selected: () => current,
    sheet: {
      getPaymentToken: async () =>
        (DEMO_SCENARIOS.find((s) => s.id === current) ?? DEMO_SCENARIOS[0]!).token,
    },
  };
}

export const demoPayments: DemoPayments = createDemoPayments();
