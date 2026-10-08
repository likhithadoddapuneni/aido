import { useEffect, useState } from 'react';

/** The current time in ms, re-read every `intervalMs`. Countdowns derive from this, so they never drift. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** The wall clock, read at the edge so screens never touch `Date` themselves. */
export const wallClockMs = (): number => Date.now();
export const wallClockIso = (): string => new Date().toISOString();
