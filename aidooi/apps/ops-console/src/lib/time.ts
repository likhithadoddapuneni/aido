/** Dubai is UTC+4 all year (no daylight saving). Every time this console shows or accepts is Dubai time. */
const DUBAI = '+04:00';

/** The month a settlement run is usually prepared for: the one before this one, as YYYY-MM, in Dubai. */
export function previousPeriod(now: Date = new Date()): string {
  const dubai = new Date(now.getTime() + 4 * 3_600_000);
  const month = dubai.getUTCMonth(); // 0-based; this month's index is the previous month's 1-based number
  const year = month === 0 ? dubai.getUTCFullYear() - 1 : dubai.getUTCFullYear();
  return `${year}-${String(month === 0 ? 12 : month).padStart(2, '0')}`;
}

/**
 * A `datetime-local` value ("2026-10-01T09:00") is wall-clock time; the API wants an instant. It means Dubai
 * time here, whatever the viewer's laptop is set to, so it agrees with how every timestamp is displayed.
 */
export function dubaiInstant(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(`${local.length === 16 ? `${local}:00` : local}${DUBAI}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
