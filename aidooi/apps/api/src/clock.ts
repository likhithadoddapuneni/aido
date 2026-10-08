import { instant, type Clock } from '@aidooi/domain';

/** The one place the process reads the wall clock. */
export const systemClock: Clock = { now: () => instant(Date.now()) };
