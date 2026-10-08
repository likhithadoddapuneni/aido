import { ZERO } from '@aidooi/domain';
import type { DepositCreditPort } from '../../ports.ts';

/** For environments with no viewing module wired in: nothing is ever credited. */
export const NO_DEPOSIT_CREDIT: DepositCreditPort = {
  quote: async () => ({ credit: ZERO, excess: ZERO }),
  apply: async () => ({ credit: ZERO, excessRefundDue: ZERO }),
  markPurchased: async () => undefined,
};
