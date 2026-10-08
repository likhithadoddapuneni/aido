import { RuleViolation } from '../kernel/errors.ts';
import { hoursBetween, type Instant } from '../kernel/time.ts';
import {
  assertTransition,
  orderLine,
  type IssueState,
  type OrderLineState,
} from '../machines/index.ts';
import { RECEIPT_AUTOCONFIRM_HOURS } from '../standards/constants.ts';

export const ISSUE_FLAGS = [
  'Delayed',
  'Delivery Failed',
  'Damaged',
  'Missing',
  'Cancellation Requested',
  'Return Requested',
  'Disputed',
] as const;
export type IssueFlag = (typeof ISSUE_FLAGS)[number];

export type SettlementState =
  'Not Eligible' | 'Eligible' | 'On Hold' | 'Included' | 'Paid' | 'Adjusted';

export interface LineFacts {
  readonly state: OrderLineState;
  readonly settlement: SettlementState;
  readonly deliveredAt: Instant | null;
  readonly openIssues: number;
}

export const isIssueOpen = (s: IssueState): boolean => s === 'Open' || s === 'Partner Handling';

/** Forward-only progression; an open issue blocks it (AID-LOG-015). Master status derives from lines. */
export function advance(line: LineFacts, to: OrderLineState, at: Instant): LineFacts {
  assertTransition(orderLine, line.state, to);
  if (to !== 'Cancelled' && to !== 'Refunded' && line.openIssues > 0) {
    throw new RuleViolation('open_issue_blocks_line', 'An open issue blocks this line.');
  }
  return {
    ...line,
    state: to,
    deliveredAt: to === 'Delivered' ? at : line.deliveredAt,
    // Only a confirmed receipt makes a line settlement-eligible (AID-LOG-014 §6).
    settlement:
      to === 'Receipt Confirmed' && line.settlement === 'Not Eligible'
        ? 'Eligible'
        : line.settlement,
  };
}

/** AID-LOG-015 §7 — auto-confirm receipt 72 h after Delivered when no issue is open. */
export function isAutoConfirmDue(line: LineFacts, now: Instant): boolean {
  return (
    line.state === 'Delivered' &&
    line.openIssues === 0 &&
    line.deliveredAt !== null &&
    hoursBetween(line.deliveredAt, now) > RECEIPT_AUTOCONFIRM_HOURS
  );
}

/** Raising an issue puts an eligible line's settlement on hold. */
export function onIssueRaised(line: LineFacts): LineFacts {
  return {
    ...line,
    openIssues: line.openIssues + 1,
    settlement: line.settlement === 'Eligible' ? 'On Hold' : line.settlement,
  };
}

/**
 * Closing an issue: a refund ends the line (before settlement it never becomes eligible); any other
 * closure releases the hold once no issue remains open.
 */
export function onIssueClosed(
  line: LineFacts,
  resolution: Extract<IssueState, 'Resolved' | 'Refunded' | 'Rejected'>,
): LineFacts {
  const openIssues = Math.max(0, line.openIssues - 1);
  if (resolution === 'Refunded') {
    return {
      ...line,
      openIssues,
      state: 'Refunded',
      settlement:
        line.settlement === 'Paid' || line.settlement === 'Included' ? 'Adjusted' : 'Not Eligible',
    };
  }
  if (openIssues > 0) return { ...line, openIssues };
  return {
    ...line,
    openIssues,
    settlement:
      line.settlement === 'On Hold'
        ? line.state === 'Receipt Confirmed'
          ? 'Eligible'
          : 'Not Eligible'
        : line.settlement,
  };
}

export type MasterStatus =
  'Confirmed' | 'In Progress' | 'Issue Reported' | 'Completed' | 'Cancelled';

/** The buyer-facing status derives from the lines; a finished line is never blocked by a sibling. */
export function masterStatus(
  lines: readonly Pick<LineFacts, 'state' | 'openIssues'>[],
): MasterStatus {
  if (lines.length === 0) return 'Confirmed';
  const live = lines.filter((l) => l.state !== 'Cancelled' && l.state !== 'Refunded');
  if (live.length === 0) return 'Cancelled';
  if (live.some((l) => l.openIssues > 0)) return 'Issue Reported';
  if (live.every((l) => l.state === 'Receipt Confirmed')) return 'Completed';
  if (live.every((l) => l.state === 'Confirmed')) return 'Confirmed';
  return 'In Progress';
}
