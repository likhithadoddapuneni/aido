import { z } from 'zod';
import { FilsSchema, InstantSchema, UuidSchema } from './common.ts';

const Quantity = z.number().int().min(1).max(20);

/** What the buyer is checking out: a composition (minus anything they removed), or explicit lines. */
export const StartCheckoutBodySchema = z.object({
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('composition'), compositionId: UuidSchema }),
    z.object({
      kind: z.literal('lines'),
      lines: z
        .array(
          z.object({
            offerId: z.string().regex(/^AIO-\d{8}$/),
            quantity: Quantity,
            /** The price the buyer was shown. A difference from the live price needs their approval. */
            expectedUnitPrice: FilsSchema.positive(),
          }),
        )
        .min(1)
        .max(60),
    }),
  ]),
  /** A completed viewing whose deposit should be credited against this order. */
  viewingRequestId: UuidSchema.optional(),
});

export const CheckoutParamsSchema = z.object({ checkoutId: UuidSchema });

export const CheckoutLineSchema = z.object({
  offerId: z.string(),
  productId: z.string(),
  productName: z.string(),
  sellerName: z.string(),
  quantity: z.number().int(),
  quotedUnitPrice: FilsSchema,
  currentUnitPrice: FilsSchema,
  status: z.enum([
    'Confirmed',
    'Awaiting Seller',
    'Price Changed',
    'Stock Unavailable',
    'Offer Inactive',
  ]),
});

export const CheckoutSchema = z.object({
  id: UuidSchema,
  state: z.enum([
    'Awaiting Seller Confirmation',
    'Awaiting Price Approval',
    'Ready to Pay',
    'Payment Requires Action',
    'Rebuild Required',
    'Expired',
    'Paid',
  ]),
  lines: z.array(CheckoutLineSchema),
  total: FilsSchema,
  /** A completed viewing's deposit applied to this order, and what the buyer pays after it. */
  depositCredit: FilsSchema,
  payable: FilsSchema,
  /** The 24-hour purchase window (AID-LOG-014), once every seller validation is in. */
  expiresAt: InstantSchema.nullable(),
  pendingSellerConfirmations: z.number().int(),
  orderId: UuidSchema.nullable(),
});
export type Checkout = z.infer<typeof CheckoutSchema>;

export const DeliverySchema = z.object({
  recipientName: z.string().min(2).max(120),
  phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
  line1: z.string().min(3).max(200),
  line2: z.string().max(200).optional(),
  area: z.string().max(100).optional(),
  emirate: z.enum([
    'Abu Dhabi',
    'Dubai',
    'Sharjah',
    'Ajman',
    'Umm Al Quwain',
    'Ras Al Khaimah',
    'Fujairah',
  ]),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  instructions: z.string().max(300).optional(),
});

export const PayBodySchema = z.object({
  /** Opaque token from the payment provider's client SDK. Card data never reaches AIDOOi. */
  paymentToken: z.string().min(4).max(256),
  delivery: DeliverySchema,
});

/** One payment, one order. If the bank asks the buyer to authenticate, the client opens `actionUrl`. */
export const PayResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('paid'),
    orderId: UuidSchema,
    paid: FilsSchema,
    depositCredit: FilsSchema,
  }),
  z.object({
    status: z.literal('requires_action'),
    paymentId: UuidSchema,
    actionUrl: z.string().url(),
  }),
]);

export const ApprovePricesBodySchema = z.object({
  /** The total the buyer is approving, so approval is of a specific number, never a blank cheque. */
  approvedTotal: FilsSchema.positive(),
});

export const PurchaseTaskParamsSchema = z.object({ taskId: UuidSchema });
export const PurchaseTaskRespondBodySchema = z.object({
  response: z.enum(['Confirmed', 'Declined']),
});

export const PurchaseTaskSchema = z.object({
  id: UuidSchema,
  dueAt: InstantSchema,
  responded: z.enum(['Confirmed', 'Declined']).nullable(),
  lines: z.array(
    z.object({
      offerId: z.string(),
      productName: z.string(),
      sellerSku: z.string(),
      quantity: z.number().int(),
      unitPrice: FilsSchema,
      stockQty: z.number().int(),
    }),
  ),
});
export const PurchaseTasksSchema = z.object({ tasks: z.array(PurchaseTaskSchema) });
