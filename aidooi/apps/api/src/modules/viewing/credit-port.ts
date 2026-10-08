import type { AppContext } from '../../context.ts';
import type { DepositCreditPort } from '../../ports.ts';
import { creditDepositForOrder, markViewingPurchased, quoteDepositCredit } from './credit.ts';

/**
 * Adapts the viewing module's credit functions to the port checkout depends on. Takes the context
 * lazily because the port is itself part of the context.
 */
export function createDepositCreditPort(getCtx: () => AppContext): DepositCreditPort {
  const now = () => getCtx().clock.now();
  return {
    quote: (trx, a) => quoteDepositCredit(trx, { ...a, now: now() }),
    apply: (trx, a) => creditDepositForOrder(trx, getCtx(), { ...a, now: now() }),
    markPurchased: (trx, id) => markViewingPurchased(trx, id),
  };
}
