import { z } from 'zod';

export const LiveResponseSchema = z.object({ status: z.literal('ok') });
export const ReadyResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.record(z.string(), z.enum(['ok', 'fail'])),
  version: z.string(),
});
