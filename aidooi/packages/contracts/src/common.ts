import { z } from 'zod';

/** Money on the wire is an integer number of fils (1 AED = 100 fils). Never a float, never a string. */
export const FilsSchema = z
  .number()
  .int()
  .nonnegative()
  .describe('Amount in fils (1 AED = 100 fils)');
export const SignedFilsSchema = z.number().int().describe('Signed amount in fils');

export const UuidSchema = z.uuid();
export const InstantSchema = z.iso.datetime().describe('ISO-8601 timestamp, UTC');

export const CorrelationHeaderSchema = z.object({
  'x-correlation-id': z.string().min(8).max(128).optional(),
});

/** RFC 9457 problem details. `code` is stable and machine-readable; `title` and `detail` are for people. */
export const ProblemSchema = z
  .object({
    type: z.string().describe('URI reference identifying the problem type'),
    title: z.string(),
    status: z.number().int(),
    code: z.string().describe('Stable machine-readable error code'),
    detail: z.string().optional(),
    correlationId: z.string(),
    errors: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .describe('Field-level validation errors'),
  })
  .describe('Problem details (RFC 9457)');
export type Problem = z.infer<typeof ProblemSchema>;

export const PageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(256).optional(),
});

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export const IdempotencyHeaderSchema = z.object({
  'idempotency-key': z
    .string()
    .min(16)
    .max(128)
    .describe('Client-generated key; a retry with the same key returns the original result'),
});

/** Every non-2xx response in this API has one of these shapes. */
export const errorResponses = {
  400: ProblemSchema,
  401: ProblemSchema,
  402: ProblemSchema,
  403: ProblemSchema,
  404: ProblemSchema,
  409: ProblemSchema,
  422: ProblemSchema,
  429: ProblemSchema,
  503: ProblemSchema,
} as const;

/** `response: { 200: X, ...errorsFor(401, 404) }` — declare only the problems a route can actually return. */
export function errorsFor<const K extends keyof typeof errorResponses>(
  ...codes: K[]
): Pick<typeof errorResponses, K> {
  return Object.fromEntries(codes.map((c) => [c, errorResponses[c]])) as Pick<
    typeof errorResponses,
    K
  >;
}
