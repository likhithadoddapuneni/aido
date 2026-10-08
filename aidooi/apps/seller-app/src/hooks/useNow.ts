import { useEffect, useState } from 'react';

/** The current time, ticking every `everyMs`. Drives live countdowns without each row owning a timer. */
export function useNow(everyMs = 1000, clock: () => number = Date.now): number {
  const [now, setNow] = useState(clock);
  useEffect(() => {
    const id = setInterval(() => setNow(clock()), everyMs);
    return () => clearInterval(id);
  }, [everyMs, clock]);
  return now;
}
