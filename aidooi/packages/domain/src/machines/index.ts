import { defineMachine } from './machine.ts';

export * from './machine.ts';

/** AID-LOG-012 Rev 2 — Product & Project Viewing. */
export const viewingRequest = defineMachine({
  name: 'viewing_request',
  initial: 'Draft',
  transitions: {
    Draft: ['Awaiting Seller Confirmation', 'Awaiting Deposit', 'Cancelled'],
    'Awaiting Seller Confirmation': ['Awaiting Deposit', 'Cancelled'],
    'Awaiting Deposit': ['Confirmed', 'Cancelled'],
    Confirmed: ['Completed', 'No-show', 'Cancelled'],
    Completed: [],
    'No-show': [],
    Cancelled: [],
  },
});

/** Deposit disposition (AID-LOG-012 §9–12). Completed viewing → Held is modelled on the request. */
export const viewingDeposit = defineMachine({
  name: 'viewing_deposit',
  initial: 'Pending',
  transitions: {
    Pending: ['Paid'],
    Paid: ['Credited', 'Refunded', 'Non-refundable'],
    Credited: [],
    Refunded: [],
    'Non-refundable': [],
  },
});

/** AID-LOG-014 §3 — purchase reservation window. */
export const reservation = defineMachine({
  name: 'reservation',
  initial: 'Active',
  transitions: {
    Active: ['Converted', 'Released', 'Expired'],
    Converted: [],
    Released: [],
    Expired: [],
  },
});

/** One payment per checkout. Authorise → validate → capture; void if any seller fails after auth. */
export const payment = defineMachine({
  name: 'payment',
  initial: 'Pending',
  transitions: {
    Pending: ['Authorized', 'Failed'],
    Authorized: ['Successful', 'Voided', 'Failed'],
    Successful: ['Refunded'],
    Failed: [],
    Voided: [],
    Refunded: [],
  },
});

/** AID-LOG-015 — line-level fulfilment. A finished line is never blocked by an unfinished sibling. */
export const orderLine = defineMachine({
  name: 'order_line',
  initial: 'Confirmed',
  transitions: {
    Confirmed: ['Preparing', 'Cancelled', 'Refunded'],
    Preparing: ['Ready for Dispatch', 'Cancelled', 'Refunded'],
    'Ready for Dispatch': ['Dispatched', 'Cancelled', 'Refunded'],
    Dispatched: ['Delivered', 'Refunded'],
    Delivered: ['Receipt Confirmed', 'Refunded'],
    'Receipt Confirmed': ['Refunded'],
    Cancelled: [],
    Refunded: [],
  },
});

export const issue = defineMachine({
  name: 'issue',
  initial: 'Open',
  transitions: {
    Open: ['Partner Handling', 'Resolved', 'Refunded', 'Rejected'],
    'Partner Handling': ['Resolved', 'Refunded', 'Rejected'],
    Resolved: [],
    Refunded: [],
    Rejected: [],
  },
});

/** AID-LOG-013 — activation is a manual ops gate. */
export const partnerStatus = defineMachine({
  name: 'partner_status',
  initial: 'Requested',
  transitions: {
    Requested: ['Under Review'],
    'Under Review': ['Approved/Agreement Pending', 'Requested'],
    'Approved/Agreement Pending': ['Active', 'Under Review'],
    Active: ['Inactive'],
    Inactive: ['Active'],
  },
});

/** AID-DATA-014 — only Verified records can enter recommendation. */
export const dataStatus = defineMachine({
  name: 'data_status',
  initial: 'Incomplete',
  transitions: {
    Incomplete: ['Ready for Review'],
    'Ready for Review': ['Verified', 'Incomplete'],
    // Any edit of verified data drops it back to review: a seller cannot change a Verified product silently.
    Verified: ['Ready for Review'],
  },
});

export const MACHINES = {
  viewingRequest,
  viewingDeposit,
  reservation,
  payment,
  orderLine,
  issue,
  partnerStatus,
  dataStatus,
} as const;

export type ViewingRequestState = (typeof viewingRequest.states)[number];
export type ViewingDepositState = (typeof viewingDeposit.states)[number];
export type ReservationState = (typeof reservation.states)[number];
export type PaymentState = (typeof payment.states)[number];
export type OrderLineState = (typeof orderLine.states)[number];
export type IssueState = (typeof issue.states)[number];
export type PartnerStatus = (typeof partnerStatus.states)[number];
export type DataStatus = (typeof dataStatus.states)[number];
