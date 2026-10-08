/** Pure time helpers. Screens pass `now` in, so countdowns are testable without fake timers. */

export interface Remaining {
  readonly totalMs: number;
  readonly expired: boolean;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  /** `23:59:07` — fixed width so the number does not jump as it ticks. */
  readonly clock: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function remaining(untilIso: string, nowMs: number): Remaining {
  const totalMs = Math.max(0, new Date(untilIso).getTime() - nowMs);
  const s = Math.floor(totalMs / 1000);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  return {
    totalMs,
    expired: totalMs === 0,
    hours,
    minutes,
    seconds,
    clock: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`,
  };
}

/** UAE time is UTC+4 all year (no daylight saving), so slots are computed from that fixed offset. */
export const DUBAI_OFFSET_MS = 4 * 3_600_000;

export interface VisitSlot {
  /** ISO instant to send to the API. */
  readonly iso: string;
  /** Day offset from today in Dubai (0 = today). */
  readonly dayOffset: number;
  /** Hour of day in Dubai, 24h. */
  readonly hour: number;
}

export const SLOT_HOURS = [10, 12, 14, 16, 18] as const;

/**
 * Times to offer for a visit: the next seven days, five showroom-friendly hours a day, never earlier than
 * `leadMinutes` from now. Offered times are a convenience; the seller still confirms the showroom is open.
 */
export function visitSlots(nowMs: number, days = 7, leadMinutes = 90): VisitSlot[] {
  const dubaiNow = nowMs + DUBAI_OFFSET_MS;
  const midnight = Math.floor(dubaiNow / 86_400_000) * 86_400_000;
  const out: VisitSlot[] = [];
  for (let d = 0; d < days; d++) {
    for (const hour of SLOT_HOURS) {
      const instant = midnight + d * 86_400_000 + hour * 3_600_000 - DUBAI_OFFSET_MS;
      if (instant >= nowMs + leadMinutes * 60_000) {
        out.push({ iso: new Date(instant).toISOString(), dayOffset: d, hour });
      }
    }
  }
  return out;
}

export const formatDateTime = (iso: string, locale: 'en' | 'ar'): string =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dubai',
  }).format(new Date(iso));

export const formatDay = (iso: string, locale: 'en' | 'ar'): string =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Dubai',
  }).format(new Date(iso));

export const formatTime = (iso: string, locale: 'en' | 'ar'): string =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    timeStyle: 'short',
    timeZone: 'Asia/Dubai',
  }).format(new Date(iso));
