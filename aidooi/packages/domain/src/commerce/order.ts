import { RuleViolation } from '../kernel/errors.ts';
import type { OfferId, PartnerId, ProductId } from '../kernel/ids.ts';
import { allocate, max, percentOf, sub, sum, times, type Bps, type Fils } from '../kernel/money.ts';
import type { Instant } from '../kernel/time.ts';
import type { ReservationPlan } from './validation.ts';

/** What is locked at successful payment and never read from live data again (AID-LOG-014 §7). */
export interface LineSnapshot {
  readonly productId: ProductId;
  readonly offerId: OfferId;
  readonly partnerId: PartnerId;
  readonly productName: string;
  readonly quantity: number;
  readonly unitPrice: Fils;
  readonly grossLine: Fils;
  readonly commissionRate: Bps;
  /** Computed and rounded once, here. Settlement sums this; it never re-derives it. */
  readonly commission: Fils;
}

export interface OrderLineDraft {
  readonly snapshot: LineSnapshot;
}
export interface SellerOrderDraft {
  readonly partnerId: PartnerId;
  readonly lines: readonly OrderLineDraft[];
  readonly gross: Fils;
}
export interface MasterOrderDraft {
  readonly sellerOrders: readonly SellerOrderDraft[];
  readonly gross: Fils;
  readonly depositCredit: Fils;
  /** Gross − deposit credit: what the payment provider must capture. */
  readonly payable: Fils;
}

export interface PricedLine {
  readonly productId: ProductId;
  readonly offerId: OfferId;
  readonly partnerId: PartnerId;
  readonly productName: string;
  readonly quantity: number;
  readonly unitPrice: Fils;
  readonly commissionRate: Bps;
}

export function snapshotOf(line: PricedLine): LineSnapshot {
  const grossLine = times(line.unitPrice, line.quantity);
  return { ...line, grossLine, commission: percentOf(grossLine, line.commissionRate) };
}

/**
 * One cart → one checkout → one payment to AIDOOi, then a backend-only split into seller orders
 * and lines, each with a locked snapshot (AID-LOG-014). The buyer sees a single order.
 */
export function splitOrder(lines: readonly PricedLine[], depositCredit: Fils): MasterOrderDraft {
  if (lines.length === 0)
    throw new RuleViolation('empty_order', 'An order needs at least one line');
  const bySeller = new Map<PartnerId, OrderLineDraft[]>();
  for (const l of lines) {
    const list = bySeller.get(l.partnerId) ?? [];
    list.push({ snapshot: snapshotOf(l) });
    bySeller.set(l.partnerId, list);
  }
  const sellerOrders = [...bySeller.entries()].map(([partnerId, ls]) => ({
    partnerId,
    lines: ls,
    gross: sum(ls.map((l) => l.snapshot.grossLine)),
  }));
  const gross = sum(sellerOrders.map((s) => s.gross));
  const credit = depositCredit > gross ? gross : depositCredit;
  return {
    sellerOrders,
    gross,
    depositCredit: credit,
    payable: max(sub(gross, credit), 0 as Fils),
  };
}

/** Payment gate: refuse to capture unless every required seller validation stands (AID-LOG-014). */
export function assertCapturable(plan: ReservationPlan, now: Instant): void {
  if (plan.outcome === 'Rebuild Required') {
    throw new RuleViolation(
      'seller_validation_failed',
      'A seller could not confirm; the composition must be rebuilt.',
    );
  }
  if (plan.outcome === 'Approval Required') {
    throw new RuleViolation(
      'price_approval_required',
      'A price changed; the buyer must approve the new total.',
    );
  }
  if (plan.expiresAt === null || now > plan.expiresAt) {
    throw new RuleViolation(
      'reservation_expired',
      'The 24-hour purchase window has expired. Revalidate to continue.',
    );
  }
}

/**
 * Where a refund goes. The buyer paid with two instruments: the capture of this order and, if a
 * viewing deposit was credited, the earlier deposit payment. Refunds return to the capture first
 * (up to what was captured), then to the deposit payment — never more than was paid on either,
 * and the totals always reconcile exactly (ADR-031).
 */
export interface RefundPlan {
  readonly toCapture: Fils;
  readonly toDeposit: Fils;
}

export function planRefund(args: {
  readonly refundAmount: Fils;
  readonly captured: Fils;
  readonly alreadyRefundedToCapture: Fils;
  readonly depositCredited: Fils;
  readonly alreadyRefundedToDeposit: Fils;
}): RefundPlan {
  const capturable = sub(args.captured, args.alreadyRefundedToCapture);
  const depositable = sub(args.depositCredited, args.alreadyRefundedToDeposit);
  if (args.refundAmount > sum([capturable, depositable])) {
    throw new RuleViolation('refund_exceeds_paid', 'Refund exceeds the amount paid on this order');
  }
  const toCapture = args.refundAmount < capturable ? args.refundAmount : capturable;
  return { toCapture, toDeposit: sub(args.refundAmount, toCapture) };
}

/** Spread an order-level amount (e.g. deposit credit) across lines so parts sum exactly. */
export const allocateAcrossLines = (total: Fils, grossLines: readonly Fils[]): Fils[] =>
  allocate(total, grossLines);
