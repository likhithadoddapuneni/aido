import { describe, expect, it } from 'vitest';
import {
  MACHINES,
  assertTransition,
  canTransition,
  edges,
  isTerminal,
  IllegalTransition,
  type Machine,
} from '../src/index.ts';

const ALL = Object.values(MACHINES) as unknown as Machine<string>[];

describe.each(ALL)('machine $name', (m) => {
  it('every state is reachable from the initial state', () => {
    const seen = new Set<string>([m.initial]);
    const queue = [m.initial as string];
    while (queue.length) {
      const s = queue.pop() as string;
      for (const t of m.transitions[s] as readonly string[]) {
        if (!seen.has(t)) {
          seen.add(t);
          queue.push(t);
        }
      }
    }
    expect([...seen].sort()).toEqual([...m.states].sort());
  });

  it('has no self-loops in its edge list and no duplicate edges', () => {
    const list = edges(m).map((e) => `${e.from}>${e.to}`);
    expect(new Set(list).size).toBe(list.length);
    expect(edges(m).every((e) => e.from !== e.to)).toBe(true);
  });
});

describe('transitions', () => {
  it('terminal states cannot move', () => {
    expect(isTerminal(MACHINES.payment, 'Voided')).toBe(true);
    expect(() => assertTransition(MACHINES.payment, 'Voided', 'Authorized')).toThrow(
      IllegalTransition,
    );
  });

  it('same-state updates are allowed (idempotent writes)', () => {
    expect(canTransition(MACHINES.orderLine, 'Preparing', 'Preparing')).toBe(true);
  });

  it('order lines cannot skip steps', () => {
    expect(canTransition(MACHINES.orderLine, 'Confirmed', 'Delivered')).toBe(false);
    expect(canTransition(MACHINES.orderLine, 'Preparing', 'Ready for Dispatch')).toBe(true);
  });

  it('payment must be authorised before it can succeed (no capture without authorisation)', () => {
    expect(canTransition(MACHINES.payment, 'Pending', 'Successful')).toBe(false);
    expect(canTransition(MACHINES.payment, 'Authorized', 'Successful')).toBe(true);
    expect(canTransition(MACHINES.payment, 'Authorized', 'Voided')).toBe(true);
  });

  it('a deposit can only be disposed of once it has been paid', () => {
    expect(canTransition(MACHINES.viewingDeposit, 'Pending', 'Refunded')).toBe(false);
    expect(canTransition(MACHINES.viewingDeposit, 'Paid', 'Non-refundable')).toBe(true);
  });

  it('verified product data can only go back to review, never be edited in place', () => {
    expect(canTransition(MACHINES.dataStatus, 'Verified', 'Incomplete')).toBe(false);
    expect(canTransition(MACHINES.dataStatus, 'Verified', 'Ready for Review')).toBe(true);
    expect(canTransition(MACHINES.dataStatus, 'Incomplete', 'Verified')).toBe(false);
  });

  it('a partner is activated only after approval', () => {
    expect(canTransition(MACHINES.partnerStatus, 'Under Review', 'Active')).toBe(false);
    expect(canTransition(MACHINES.partnerStatus, 'Approved/Agreement Pending', 'Active')).toBe(
      true,
    );
  });
});
