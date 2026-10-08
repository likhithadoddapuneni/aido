import { z } from 'zod';
import { FilsSchema, InstantSchema, SignedFilsSchema, UuidSchema, pageOf } from './common.ts';

export const PeriodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
export const RunStateSchema = z.enum(['Draft', 'Approved', 'Paid']);

export const CreateRunBodySchema = z.object({ period: PeriodSchema });

export const RunViewSchema = z.object({
  id: UuidSchema,
  partnerId: UuidSchema,
  partnerName: z.string(),
  period: PeriodSchema,
  state: RunStateSchema,
  grossFils: FilsSchema,
  commissionFils: FilsSchema,
  /** Net of commission, of lines already paid and refunded since. */
  adjustmentFils: FilsSchema,
  netFils: SignedFilsSchema,
  approvedAt: InstantSchema.nullable(),
  paidAt: InstantSchema.nullable(),
  payoutRef: z.string().nullable(),
});
export type RunView = z.infer<typeof RunViewSchema>;

export const CreateRunResponseSchema = z.object({
  period: PeriodSchema,
  runs: z.array(RunViewSchema),
  /** Gross of lines held back by an open issue, per partner; reported, never paid. */
  held: z.array(z.object({ partnerId: UuidSchema, grossFils: FilsSchema })),
});

export const RunListQuerySchema = z.object({
  period: PeriodSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(256).optional(),
});
export const RunPageSchema = pageOf(RunViewSchema);
export const MarkPaidBodySchema = z.object({ bankReference: z.string().trim().min(3).max(100) });

export const StatementLineSchema = z.object({
  orderLineId: UuidSchema,
  kind: z.enum(['Sale', 'Clawback']),
  productName: z.string(),
  grossFils: FilsSchema,
  commissionFils: FilsSchema,
  netFils: FilsSchema,
});
export const StatementSummarySchema = z.object({
  id: UuidSchema,
  runId: UuidSchema,
  period: PeriodSchema,
  state: RunStateSchema,
  netFils: SignedFilsSchema,
  issuedAt: InstantSchema,
});
export const StatementDetailSchema = StatementSummarySchema.extend({
  taxInvoiceNo: z.string().nullable(),
  grossFils: FilsSchema,
  commissionFils: FilsSchema,
  adjustmentFils: FilsSchema,
  lines: z.array(StatementLineSchema),
});
export const StatementPageSchema = pageOf(StatementSummarySchema);
export const StatementListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(256).optional(),
});
