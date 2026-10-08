import { z } from 'zod';
import { FilsSchema, InstantSchema, UuidSchema } from './common.ts';

export const ViewingStateSchema = z.enum([
  'Draft',
  'Awaiting Seller Confirmation',
  'Awaiting Deposit',
  'Confirmed',
  'Completed',
  'No-show',
  'Cancelled',
]);
export const StopConfirmationSchema = z.enum(['Pending', 'Confirmed', 'Declined']);
export const DepositStateSchema = z.enum([
  'Pending',
  'Paid',
  'Credited',
  'Refunded',
  'Non-refundable',
]);

export const DepositQuoteSchema = z.object({
  base: FilsSchema.describe('Sum of the selected products’ Current Selling Price'),
  amount: FilsSchema.describe('5% of base, at most AED 500'),
  capped: z.boolean(),
});

export const ViewingProductSchema = z.object({
  offerId: z.string(),
  productId: z.string(),
  name: z.string(),
  quantity: z.number().int().positive(),
  unitPrice: FilsSchema,
});

export const ViewingStopSchema = z.object({
  id: UuidSchema,
  stopNo: z.number().int(),
  partnerName: z.string(),
  locationName: z.string(),
  address: z.string(),
  confirmation: StopConfirmationSchema,
  attendance: z.enum(['Attended', 'No-show']).nullable(),
  products: z.array(ViewingProductSchema),
});

export const ViewingSchema = z.object({
  id: UuidSchema,
  state: ViewingStateSchema,
  compositionId: UuidSchema.nullable(),
  scheduledAt: InstantSchema.nullable(),
  stops: z.array(ViewingStopSchema),
  /** Quote over the stops that will actually be visited; the stored deposit exists from Awaiting Deposit on. */
  depositQuote: DepositQuoteSchema,
  deposit: z
    .object({ state: DepositStateSchema, amount: FilsSchema, credited: FilsSchema.nullable() })
    .nullable(),
  /** The buyer must decide what to do about stops a showroom declined. */
  needsDecision: z.boolean(),
  /** QR pass; present once the viewing is Confirmed. */
  pass: z.string().nullable(),
  createdAt: InstantSchema,
});
export type Viewing = z.infer<typeof ViewingSchema>;

export const CreateViewingBodySchema = z.object({
  compositionId: UuidSchema,
  /** Restrict the viewing to some of the composition's products. Omit for all. */
  itemSlotKeys: z.array(z.string().min(1)).min(1).optional(),
});

export const ViewingIdParamsSchema = z.object({ id: UuidSchema });

export const PayDepositBodySchema = z.object({
  paymentToken: z.string().min(1).max(200).describe('Opaque token from the payment provider SDK'),
  scheduledAt: InstantSchema.describe('When the buyer intends to visit'),
});

export const DepositResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('confirmed'), viewing: ViewingSchema }),
  z.object({ status: z.literal('requires_action'), actionUrl: z.string() }),
]);

export const PassSchema = z.object({
  token: z.string(),
  validFrom: InstantSchema,
  validUntil: InstantSchema,
});

/* ---------------- Seller ---------------- */

export const ViewingTaskSchema = z.object({
  id: UuidSchema,
  viewingRequestId: UuidSchema,
  stopId: UuidSchema,
  dueAt: InstantSchema,
  response: z.enum(['Confirmed', 'Declined']).nullable(),
  locationName: z.string(),
  products: z.array(ViewingProductSchema.extend({ onDisplay: z.boolean() })),
});

export type ViewingTask = z.infer<typeof ViewingTaskSchema>;

export const RespondBodySchema = z.object({
  response: z.enum(['Confirmed', 'Declined']),
  /** True when every item the buyer wants to see is on the showroom floor right now. */
  displayConfirmed: z.boolean().optional(),
});
export const TaskIdParamsSchema = z.object({ id: UuidSchema });

export const ScanBodySchema = z.object({ token: z.string().min(10).max(1000) });
export const ScanResultSchema = z.object({
  viewingRequestId: UuidSchema,
  stopId: UuidSchema,
  scheduledAt: InstantSchema,
  buyerName: z.string().nullable(),
  products: z.array(ViewingProductSchema),
  checkedInAt: InstantSchema,
});

export const OutcomeBodySchema = z.object({ outcome: z.enum(['Completed', 'No-show']) });
export const OutcomeResultSchema = z.object({
  stopAttendance: z.enum(['Attended', 'No-show']),
  viewingState: ViewingStateSchema,
});

export const RespondResultSchema = z.object({
  taskId: UuidSchema,
  response: z.enum(['Confirmed', 'Declined']),
  viewingState: ViewingStateSchema,
});
