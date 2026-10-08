import { createHash } from 'node:crypto';
import type { AppContext } from './context.ts';

/**
 * Is a feature on? A flag that does not exist is off. With a partial rollout, the answer is stable
 * per subject (the same customer always lands on the same side) and a subject is required: with
 * none, a partial rollout is off rather than flapping per request.
 */
export async function isEnabled(
  ctx: Pick<AppContext, 'db'>,
  key: string,
  subject?: string,
): Promise<boolean> {
  const flag = await ctx.db
    .selectFrom('platform.feature_flag')
    .select(['enabled', 'rollout_pct'])
    .where('key', '=', key)
    .executeTakeFirst();
  if (!flag?.enabled) return false;
  if (flag.rollout_pct >= 100) return true;
  if (flag.rollout_pct <= 0 || !subject) return false;
  return bucketOf(key, subject) < flag.rollout_pct;
}

/** 0–99, uniform and deterministic in (key, subject). */
export const bucketOf = (key: string, subject: string): number =>
  createHash('sha256').update(`${key}:${subject}`).digest().readUInt32BE(0) % 100;
