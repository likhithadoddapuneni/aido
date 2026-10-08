/**
 * Confirmation tasks have a deadline (ADR-028: purchase 4 h, viewing 12 h). Past it the API treats the
 * task as declined, so the shop floor must see — at a glance — what is about to lapse.
 */
export type Urgency = 'overdue' | 'critical' | 'soon' | 'ok';

export const CRITICAL_MS = 30 * 60_000;
export const SOON_MS = 2 * 3_600_000;

export const remainingMs = (dueAt: string | number, nowMs: number): number =>
  new Date(dueAt).getTime() - nowMs;

export function urgencyOf(ms: number): Urgency {
  if (ms <= 0) return 'overdue';
  if (ms < CRITICAL_MS) return 'critical';
  if (ms < SOON_MS) return 'soon';
  return 'ok';
}

export interface Countdown {
  readonly overdue: boolean;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
}

/** Whole-unit parts of a duration; rounds *up* the final second so "0s left" is never shown while time remains. */
export function countdown(ms: number): Countdown {
  const overdue = ms <= 0;
  const total = Math.ceil(Math.abs(ms) / 1000);
  return {
    overdue,
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/** `1h 05m`, `12m 30s`, `45s` — compact, locale-neutral digits; the label around it is translated. */
export function formatCountdown(c: Countdown): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  if (c.hours > 0) return `${c.hours}h ${pad(c.minutes)}m`;
  if (c.minutes > 0) return `${c.minutes}m ${pad(c.seconds)}s`;
  return `${c.seconds}s`;
}

export interface Deadlined {
  readonly id: string;
  readonly dueAt: string;
  /** Already answered tasks sink to the bottom. */
  readonly answered: boolean;
}

/**
 * The inbox order: open tasks by time left (least first, so overdue and critical lead), answered ones
 * last, ties broken by id so the order never flickers.
 */
export function sortByUrgency<T extends Deadlined>(tasks: readonly T[], nowMs: number): T[] {
  return [...tasks].sort((a, b) => {
    if (a.answered !== b.answered) return a.answered ? 1 : -1;
    return remainingMs(a.dueAt, nowMs) - remainingMs(b.dueAt, nowMs) || (a.id < b.id ? -1 : 1);
  });
}
