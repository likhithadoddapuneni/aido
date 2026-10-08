import { z } from 'zod';
import { FilsSchema, InstantSchema, UuidSchema, pageOf } from './common.ts';

export const OrderLineStateSchema = z.enum([
  'Confirmed',
  'Preparing',
  'Ready for Dispatch',
  'Dispatched',
  'Delivered',
  'Receipt Confirmed',
  'Cancelled',
  'Refunded',
]);
export const MasterStatusSchema = z.enum([
  'Confirmed',
  'In Progress',
  'Issue Reported',
  'Completed',
  'Cancelled',
]);
export const IssueFlagSchema = z.enum([
  'Delayed',
  'Delivery Failed',
  'Damaged',
  'Missing',
  'Cancellation Requested',
  'Return Requested',
  'Disputed',
]);
export const IssueStateSchema = z.enum([
  'Open',
  'Partner Handling',
  'Resolved',
  'Refunded',
  'Rejected',
]);

export const IssueViewSchema = z.object({
  id: UuidSchema,
  orderLineId: UuidSchema,
  flag: IssueFlagSchema,
  state: IssueStateSchema,
  note: z.string().nullable(),
  raisedAt: InstantSchema,
  resolvedAt: InstantSchema.nullable(),
  resolutionNote: z.string().nullable(),
  productName: z.string(),
});
export type IssueView = z.infer<typeof IssueViewSchema>;

/** What a buyer sees of a line. There is deliberately no seller identity here: the buyer has one order. */
export const BuyerLineSchema = z.object({
  id: UuidSchema,
  productId: z.string(),
  productName: z.string(),
  quantity: z.number().int().positive(),
  unitPriceFils: FilsSchema,
  grossLineFils: FilsSchema,
  state: OrderLineStateSchema,
  deliveredAt: InstantSchema.nullable(),
  receiptConfirmedAt: InstantSchema.nullable(),
  openIssues: z.array(z.object({ id: UuidSchema, flag: IssueFlagSchema, state: IssueStateSchema })),
});
export type BuyerLine = z.infer<typeof BuyerLineSchema>;

export const BuyerOrderSchema = z.object({
  id: UuidSchema,
  placedAt: InstantSchema,
  status: MasterStatusSchema,
  grossFils: FilsSchema,
  depositCreditFils: FilsSchema,
  paidFils: FilsSchema,
  payment: z.object({ state: z.string(), capturedAt: InstantSchema.nullable() }).nullable(),
  estimatedDeliveryBy: InstantSchema.nullable(),
  lines: z.array(BuyerLineSchema),
});
export type BuyerOrder = z.infer<typeof BuyerOrderSchema>;
export const BuyerOrderPageSchema = pageOf(BuyerOrderSchema);

export const OrderParamsSchema = z.object({ orderId: UuidSchema });
export const OrderLineParamsSchema = z.object({ orderId: UuidSchema, lineId: UuidSchema });
export const IdParamsSchema = z.object({ id: UuidSchema });

export const RaiseIssueBodySchema = z.object({
  flag: IssueFlagSchema,
  note: z.string().trim().max(1000).optional(),
});

export const SellerDeliverySchema = z.object({
  recipientName: z.string(),
  phone: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  area: z.string().nullable(),
  emirate: z.string(),
  instructions: z.string().nullable(),
});

export const SellerLineSchema = z.object({
  id: UuidSchema,
  orderId: UuidSchema,
  productId: z.string(),
  productName: z.string(),
  quantity: z.number().int().positive(),
  unitPriceFils: FilsSchema,
  grossLineFils: FilsSchema,
  state: OrderLineStateSchema,
  createdAt: InstantSchema,
  deliveredAt: InstantSchema.nullable(),
  openIssues: z.number().int().nonnegative(),
  delivery: SellerDeliverySchema.nullable(),
});
export type SellerLine = z.infer<typeof SellerLineSchema>;
export const SellerLinePageSchema = pageOf(SellerLineSchema);

export const LineListQuerySchema = z.object({
  state: OrderLineStateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(256).optional(),
});
export const IssueListQuerySchema = z.object({
  state: IssueStateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(256).optional(),
});

/** A seller can move a line forward or cancel it before dispatch; receipt is the buyer's (or the 72 h rule's). */
export const SellerAdvanceBodySchema = z.object({
  to: z.enum(['Preparing', 'Ready for Dispatch', 'Dispatched', 'Delivered', 'Cancelled']),
  proofPhotoKey: z.string().min(3).max(300).optional(),
  reason: z.string().trim().min(3).max(500).optional(),
});
export const OpsAdvanceBodySchema = z.object({
  to: z.enum([
    'Preparing',
    'Ready for Dispatch',
    'Dispatched',
    'Delivered',
    'Receipt Confirmed',
    'Cancelled',
  ]),
  reason: z.string().trim().min(5).max(500),
  proofPhotoKey: z.string().min(3).max(300).optional(),
});
export const SellerLineResultSchema = z.object({
  id: UuidSchema,
  state: OrderLineStateSchema,
  changed: z.boolean(),
});

export const IssuePageSchema = pageOf(IssueViewSchema);
export const SellerRespondBodySchema = z.object({
  note: z.string().trim().min(1).max(1000),
  action: z.enum(['PartnerHandling', 'Resolved']),
});
export const OpsResolveBodySchema = z.object({
  resolution: z.enum(['Resolved', 'Refunded', 'Rejected']),
  note: z.string().trim().min(1).max(1000),
  /** Must equal the line's gross when given; partial refunds are not supported (see ADR-032 notes). */
  refundAmountFils: FilsSchema.optional(),
});
export const IssueResultSchema = z.object({
  id: UuidSchema,
  state: IssueStateSchema,
  lineState: OrderLineStateSchema,
});

/** A short-lived signed URL to upload one delivery-proof photograph straight to storage. */
export const ProofUploadBodySchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z.number().int().min(1).max(10_000_000),
});
export const ProofUploadSchema = z.object({
  /** Send this back as `proofPhotoKey` when advancing the line to Delivered. */
  storageKey: z.string(),
  uploadUrl: z.string().url(),
  expiresAt: InstantSchema,
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
});
