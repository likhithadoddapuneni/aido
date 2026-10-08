/* ============================================================
   commerce.js — Viewing, checkout, orders, settlement
   Implements:
     AID-LOG-012 Rev 2  Product & Project Viewing Logic
     AID-LOG-013        User, Partner & Product Administration
     AID-LOG-014        Checkout, Payment & Seller Settlement
     AID-LOG-015        Order Fulfilment, Status & Exception Mgmt
   Workflows WF-04 → WF-08.
   ============================================================ */

import { partnerById, offerById, productById } from './catalogue.js';

export const DEPOSIT_RATE = 0.05;    // AID-LOG-012 §5
export const DEPOSIT_CAP  = 500;     // AED, per viewing request
export const PURCHASE_WINDOW_HOURS = 24;   // AID-LOG-014
export const RECEIPT_AUTOCONFIRM_HOURS = 72; // AID-LOG-015

let seq = { viewing: 0, order: 0, payment: 0 };
const id = (p, n) => `${p}-${String(n).padStart(6, '0')}`;

/* ---------------- WF-04 — Viewing request ---------------- */

/** Group selected items into Viewing Stops by physical partner location (§3). */
export function buildStops(items) {
  const byPartner = new Map();
  for (const it of items) {
    const partner = partnerById[it.offer.partnerId];
    if (!byPartner.has(partner.id)) byPartner.set(partner.id, { partner, products: [] });
    byPartner.get(partner.id).products.push(it);
  }
  return [...byPartner.values()].map((s, i) => ({
    stopNo: i + 1,
    partner: s.partner,
    location: s.partner.location,
    products: s.products,
    /* Seller confirmation: On Display offers confirm immediately;
       Viewable on Request offers need a seller confirmation (§4). */
    confirmation: s.products.every(p => p.offer.onDisplay) ? 'Confirmed' : 'Awaiting Seller Confirmation'
  }));
}

/** AID-LOG-012 §5 — 5% of selected products' Current Selling Price, max AED 500. */
export function depositFor(items) {
  const base = items.reduce((t, i) => t + i.offer.sellingPrice * (i.qty || 1), 0);
  const raw = base * DEPOSIT_RATE;
  return { base, raw, amount: Math.min(raw, DEPOSIT_CAP), capped: raw > DEPOSIT_CAP };
}

export function createViewing({ items, projectId, customer }) {
  const stops = buildStops(items);
  const dep = depositFor(items);
  const vid = id('VWG', ++seq.viewing);
  return {
    id: vid,
    qr: `AIDOOI:VIEWING:${vid}:${projectId || 'PRJ'}`,
    projectId, customer,
    items, stops,
    deposit: { ...dep, state: 'Pending' },
    state: stops.every(s => s.confirmation === 'Confirmed') ? 'Awaiting Deposit' : 'Awaiting Seller Confirmation',
    attribution: { stage: 'Requested', history: [{ stage: 'Recommended', at: Date.now() }, { stage: 'Requested', at: Date.now() }] },
    createdAt: Date.now()
  };
}

export function confirmSellers(viewing) {
  viewing.stops.forEach(s => (s.confirmation = 'Confirmed'));
  viewing.state = 'Awaiting Deposit';
  viewing.attribution.stage = 'Confirmed';
  viewing.attribution.history.push({ stage: 'Confirmed', at: Date.now() });
  return viewing;
}

export function payDeposit(viewing) {
  viewing.deposit.state = 'Paid';
  viewing.state = 'Confirmed';
  return viewing;
}

/** AID-LOG-012 §9–12 — attendance outcome drives deposit disposition. */
export function recordViewingOutcome(viewing, outcome) {
  if (outcome === 'Completed') {
    viewing.state = 'Completed';
    viewing.attribution.stage = 'Viewed';
    viewing.attribution.history.push({ stage: 'Viewed', at: Date.now() });
    viewing.deposit.state = 'Held — credit on purchase, full refund if no purchase';
  } else if (outcome === 'No-show') {
    viewing.state = 'No-show';
    viewing.deposit.state = 'Non-refundable';
    viewing.attribution.stage = 'Not Purchased';
    viewing.attribution.history.push({ stage: 'No-show', at: Date.now() });
  }
  return viewing;
}

/** Deposit credit available at checkout (only a Completed viewing earns credit). */
export function depositCredit(viewing) {
  if (!viewing) return 0;
  if (viewing.state === 'Completed' && viewing.deposit.state.startsWith('Held')) return viewing.deposit.amount;
  return 0;
}

/* ---------------- WF-05 — Purchase, checkout & payment ---------------- */

/** Final Seller Validation before capture (AID-LOG-014 §3). */
export function validateSellers(items) {
  return items.map(it => {
    const offer = offerById[it.offer.id];
    const ok = offer.offerStatus === 'Active' && offer.availability !== 'Out of Stock' && offer.stockQty >= (it.qty || 1);
    const priceChanged = offer.sellingPrice !== it.offer.sellingPrice;
    return {
      item: it,
      partner: partnerById[offer.partnerId],
      confirmed: ok && !priceChanged,
      status: !ok ? 'Stock Unavailable' : priceChanged ? 'Price Change — customer approval required' : 'Confirmed',
      currentPrice: offer.sellingPrice
    };
  });
}

export function createReservation(validations) {
  const allOk = validations.every(v => v.confirmed);
  return {
    state: allOk ? 'Active' : 'Rebuild Required',
    startedAt: Date.now(),
    expiresAt: Date.now() + PURCHASE_WINDOW_HOURS * 3600 * 1000,
    lines: validations
  };
}

/**
 * One Cart → One Checkout → One Payment to AIDOOi (AID-LOG-014).
 * On success the Master Order splits into Seller Orders and Order Lines,
 * each carrying a locked transaction snapshot.
 */
export function capturePayment({ items, reservation, viewing, customer }) {
  if (reservation.state !== 'Active')
    return { ok: false, reason: 'All sellers must validate before payment can be captured.' };
  if (Date.now() > reservation.expiresAt)
    return { ok: false, reason: 'The 24-hour purchase window has expired. Revalidate to continue.' };

  const gross = items.reduce((t, i) => t + i.offer.sellingPrice * (i.qty || 1), 0);
  const credit = depositCredit(viewing);
  const payable = Math.max(0, gross - credit);

  const paymentId = id('PAY', ++seq.payment);
  const masterId = id('MO', ++seq.order);

  /* Split by seller — backend only; the customer sees one order (§8). */
  const bySeller = new Map();
  for (const it of items) {
    const partner = partnerById[it.offer.partnerId];
    if (!bySeller.has(partner.id)) bySeller.set(partner.id, []);
    bySeller.get(partner.id).push(it);
  }

  let lineNo = 0;
  const sellerOrders = [...bySeller.entries()].map(([pid, list], i) => {
    const partner = partnerById[pid];
    return {
      id: `${masterId}-S${i + 1}`,
      partner,
      lines: list.map(it => ({
        id: `${masterId}-L${++lineNo}`,
        /* Locked transaction snapshot (AID-LOG-014 §7) */
        snapshot: {
          productId: it.product.id,
          offerId: it.offer.id,
          sellerId: partner.id,
          productName: it.product.name,
          quantity: it.qty || 1,
          unitPrice: it.offer.sellingPrice,
          grossLineAmount: it.offer.sellingPrice * (it.qty || 1),
          commissionRate: it.offer.commissionRate
        },
        state: 'Confirmed',
        history: [{ state: 'Confirmed', at: Date.now() }],
        issues: [],
        settlement: 'Not Eligible'
      }))
    };
  });

  if (viewing && credit > 0) viewing.deposit.state = 'Credited';

  return {
    ok: true,
    payment: { id: paymentId, state: 'Successful', gross, depositCredit: credit, captured: payable, at: Date.now() },
    order: {
      id: masterId,
      customer,
      state: 'Paid — Confirmed',
      placedAt: Date.now(),
      gross, depositCredit: credit, paid: payable,
      sellerOrders
    }
  };
}

/* ---------------- WF-06 — Fulfilment & receipt (AID-LOG-015) ---------------- */
export const LINE_FLOW = ['Confirmed', 'Preparing', 'Ready for Dispatch', 'Dispatched', 'Delivered', 'Receipt Confirmed'];

export function advanceLine(line, to) {
  const from = LINE_FLOW.indexOf(line.state);
  const target = LINE_FLOW.indexOf(to);
  if (target !== from + 1) return { ok: false, reason: `Invalid transition ${line.state} → ${to}` };
  if (line.issues.some(i => i.state === 'Open')) return { ok: false, reason: 'An open issue blocks this line.' };
  line.state = to;
  line.history.push({ state: to, at: Date.now() });
  if (to === 'Receipt Confirmed') line.settlement = 'Eligible';     // §6 settlement eligibility
  if (to === 'Delivered') line.deliveredAt = Date.now();
  return { ok: true };
}

/** 72h auto-confirm after Delivered when no issue is open (AID-LOG-015 §7). */
export function autoConfirmEligible(line) {
  return line.state === 'Delivered' &&
         !line.issues.some(i => i.state === 'Open') &&
         line.deliveredAt && (Date.now() - line.deliveredAt) > RECEIPT_AUTOCONFIRM_HOURS * 3600 * 1000;
}

export function masterStatus(order) {
  const lines = order.sellerOrders.flatMap(s => s.lines);
  const idx = lines.map(l => LINE_FLOW.indexOf(l.state));
  if (lines.every(l => l.state === 'Receipt Confirmed' || l.state === 'Cancelled')) return 'Completed';
  if (lines.some(l => l.issues.some(i => i.state === 'Open'))) return 'Issue Reported';
  return LINE_FLOW[Math.min(...idx)] === 'Confirmed' ? 'Confirmed' : 'In Progress';
}

/* ---------------- WF-07 — Issues (AID-LOG-014/015) ---------------- */
export const ISSUE_FLAGS = ['Delayed', 'Delivery Failed', 'Damaged', 'Missing', 'Cancellation Requested', 'Return Requested', 'Disputed'];

export function raiseIssue(line, flag, note) {
  const issue = { flag, note, state: 'Open', raisedAt: Date.now(), history: [{ state: 'Open', at: Date.now() }] };
  line.issues.push(issue);
  if (line.settlement === 'Eligible') line.settlement = 'On Hold';   // §3 settlement hold
  return issue;
}

export function resolveIssue(line, issue, resolution) {
  issue.state = resolution;                                          // Resolved | Refunded | Rejected
  issue.history.push({ state: resolution, at: Date.now() });
  if (resolution === 'Refunded') {
    line.state = 'Refunded';
    line.settlement = 'Not Eligible';                                // refund before settlement prevents eligibility
  } else if (!line.issues.some(i => i.state === 'Open')) {
    line.settlement = line.state === 'Receipt Confirmed' ? 'Eligible' : 'Not Eligible';
  }
  return issue;
}

/* ---------------- WF-08 — Settlement (AID-LOG-014) ---------------- */
/** Gross Eligible Sales − Commission − Refunds/Adjustments = Net Settlement Payable. */
export function settlementRun(orders) {
  const byPartner = new Map();
  for (const o of orders) {
    for (const so of o.sellerOrders) {
      const key = so.partner.id;
      if (!byPartner.has(key)) byPartner.set(key, { partner: so.partner, gross: 0, commission: 0, adjustments: 0, lines: 0, held: 0 });
      const acc = byPartner.get(key);
      for (const l of so.lines) {
        if (l.settlement === 'Eligible') {
          acc.gross += l.snapshot.grossLineAmount;
          acc.commission += l.snapshot.grossLineAmount * l.snapshot.commissionRate;
          acc.lines++;
        } else if (l.settlement === 'On Hold') {
          acc.held += l.snapshot.grossLineAmount;
        } else if (l.state === 'Refunded') {
          acc.adjustments += l.snapshot.grossLineAmount * (1 - l.snapshot.commissionRate);
        }
      }
    }
  }
  return [...byPartner.values()].map(a => ({ ...a, net: a.gross - a.commission - a.adjustments }));
}
