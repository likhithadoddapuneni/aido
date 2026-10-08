import type { Fils } from '@aidooi/domain';
import { fils } from '@aidooi/domain';
import type { AppContext, Tx } from '../../context.ts';

interface Request {
  readonly id: string;
  readonly customer_id: string;
  readonly viewing_request_id: string | null;
}

/**
 * The viewing module's credit is repeatable per viewing — retrying the *same* order must not change
 * its answer — so the rule that a deposit credits ONE order lives here, where orders are made. (The
 * database enforces it too, with a unique index on master_order.)
 */
async function creditedByAnotherOrder(trx: Tx, request: Request): Promise<boolean> {
  if (!request.viewing_request_id) return false;
  const row = await trx
    .selectFrom('commerce.master_order')
    .select('id')
    .where('viewing_request_id', '=', request.viewing_request_id)
    .where('deposit_credit_fils', '>', 0)
    .where('purchase_request_id', '<>', request.id)
    .executeTakeFirst();
  return row !== undefined;
}

/** What this checkout would be credited right now. Read-only. */
export async function quoteCredit(
  ctx: AppContext,
  trx: Tx,
  request: Request,
  orderGross: Fils,
): Promise<Fils> {
  if (!request.viewing_request_id || (await creditedByAnotherOrder(trx, request))) return fils(0);
  const q = await ctx.depositCredit.quote(trx, {
    viewingRequestId: request.viewing_request_id,
    customerId: request.customer_id,
    orderGross,
  });
  return q.credit;
}

/** Consume the credit in the order's transaction. */
export async function applyCredit(
  ctx: AppContext,
  trx: Tx,
  request: Request,
  orderGross: Fils,
): Promise<Fils> {
  if (!request.viewing_request_id || (await creditedByAnotherOrder(trx, request))) return fils(0);
  const a = await ctx.depositCredit.apply(trx, {
    viewingRequestId: request.viewing_request_id,
    customerId: request.customer_id,
    orderGross,
  });
  return a.credit;
}
