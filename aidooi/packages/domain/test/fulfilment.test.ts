import { describe, expect, it } from 'vitest';
import {
  HOUR_MS,
  advance,
  instant,
  isAutoConfirmDue,
  masterStatus,
  onIssueClosed,
  onIssueRaised,
  type LineFacts,
} from '../src/index.ts';

const T0 = instant(1_800_000_000_000);
const line = (over: Partial<LineFacts> = {}): LineFacts => ({
  state: 'Confirmed',
  settlement: 'Not Eligible',
  deliveredAt: null,
  openIssues: 0,
  ...over,
});

describe('line progression (AID-LOG-015)', () => {
  it('walks the happy path and becomes settlement-eligible only on confirmed receipt', () => {
    let l = line();
    for (const to of ['Preparing', 'Ready for Dispatch', 'Dispatched', 'Delivered'] as const) {
      l = advance(l, to, T0);
      expect(l.settlement).toBe('Not Eligible');
    }
    expect(l.deliveredAt).toBe(T0);
    l = advance(l, 'Receipt Confirmed', T0);
    expect(l.settlement).toBe('Eligible');
  });

  it('cannot skip a step', () => {
    expect(() => advance(line(), 'Delivered', T0)).toThrowError(/not allowed/);
  });

  it('an open issue blocks progress but not cancellation or refund', () => {
    const blocked = line({ state: 'Preparing', openIssues: 1 });
    expect(() => advance(blocked, 'Ready for Dispatch', T0)).toThrowError(/open issue/i);
    expect(advance(blocked, 'Cancelled', T0).state).toBe('Cancelled');
    expect(advance(blocked, 'Refunded', T0).state).toBe('Refunded');
  });
});

describe('72-hour auto-confirmation', () => {
  const delivered = line({ state: 'Delivered', deliveredAt: T0 });
  it('is due strictly after 72 hours with no open issue', () => {
    expect(isAutoConfirmDue(delivered, instant(T0 + 72 * HOUR_MS))).toBe(false);
    expect(isAutoConfirmDue(delivered, instant(T0 + 72 * HOUR_MS + 1))).toBe(true);
  });
  it('is never due with an open issue, or before delivery', () => {
    expect(isAutoConfirmDue({ ...delivered, openIssues: 1 }, instant(T0 + 100 * HOUR_MS))).toBe(
      false,
    );
    expect(isAutoConfirmDue(line({ state: 'Dispatched' }), instant(T0 + 100 * HOUR_MS))).toBe(
      false,
    );
  });
});

describe('issues and settlement holds', () => {
  it('raising an issue holds an eligible line', () => {
    const l = onIssueRaised(line({ state: 'Receipt Confirmed', settlement: 'Eligible' }));
    expect(l).toMatchObject({ openIssues: 1, settlement: 'On Hold' });
  });
  it('raising an issue before eligibility leaves settlement alone', () => {
    expect(onIssueRaised(line({ state: 'Delivered' })).settlement).toBe('Not Eligible');
  });
  it('resolving the last issue releases the hold; resolving one of two does not', () => {
    const held = line({ state: 'Receipt Confirmed', settlement: 'On Hold', openIssues: 2 });
    expect(onIssueClosed(held, 'Resolved').settlement).toBe('On Hold');
    expect(onIssueClosed(onIssueClosed(held, 'Resolved'), 'Rejected')).toMatchObject({
      settlement: 'Eligible',
      openIssues: 0,
    });
  });
  it('a refund before settlement means the line never becomes eligible', () => {
    const l = onIssueClosed(line({ state: 'Delivered', openIssues: 1 }), 'Refunded');
    expect(l).toMatchObject({ state: 'Refunded', settlement: 'Not Eligible' });
  });
  it('a refund after the line was paid is marked for adjustment', () => {
    const l = onIssueClosed(
      line({ state: 'Receipt Confirmed', settlement: 'Paid', openIssues: 1 }),
      'Refunded',
    );
    expect(l.settlement).toBe('Adjusted');
  });
});

describe('master status derives from lines; a finished line is never blocked by a sibling', () => {
  it.each([
    [[], 'Confirmed'],
    [
      [
        { state: 'Confirmed', openIssues: 0 },
        { state: 'Confirmed', openIssues: 0 },
      ],
      'Confirmed',
    ],
    [
      [
        { state: 'Receipt Confirmed', openIssues: 0 },
        { state: 'Preparing', openIssues: 0 },
      ],
      'In Progress',
    ],
    [
      [
        { state: 'Receipt Confirmed', openIssues: 0 },
        { state: 'Receipt Confirmed', openIssues: 0 },
      ],
      'Completed',
    ],
    [
      [
        { state: 'Receipt Confirmed', openIssues: 0 },
        { state: 'Delivered', openIssues: 1 },
      ],
      'Issue Reported',
    ],
    [
      [
        { state: 'Cancelled', openIssues: 0 },
        { state: 'Receipt Confirmed', openIssues: 0 },
      ],
      'Completed',
    ],
    [
      [
        { state: 'Cancelled', openIssues: 0 },
        { state: 'Refunded', openIssues: 0 },
      ],
      'Cancelled',
    ],
  ] as const)('%j → %s', (lines, expected) => {
    expect(masterStatus(lines)).toBe(expected);
  });
});
