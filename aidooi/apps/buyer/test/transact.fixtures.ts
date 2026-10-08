import type { z } from 'zod';
import type {
  AddressSchema,
  BuyerOrderSchema,
  CheckoutSchema,
  DataExportSchema,
  MeSchema,
  ViewingSchema,
} from '@aidooi/contracts';

export const ids = {
  composition: '33333333-3333-4333-8333-333333333333',
  checkout: '44444444-4444-4444-8444-444444444444',
  order: '55555555-5555-4555-8555-555555555555',
  line: '66666666-6666-4666-8666-666666666666',
  line2: '66666666-6666-4666-8666-666666666667',
  viewing: '77777777-7777-4777-8777-777777777777',
  stop: '88888888-8888-4888-8888-888888888888',
  stop2: '88888888-8888-4888-8888-888888888889',
  address: '99999999-9999-4999-8999-999999999999',
  customer: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
} as const;

/** An instant `h` hours from the real now; screens read the real clock, so fixtures must too. */
export const inHours = (h: number): string => new Date(Date.now() + h * 3_600_000).toISOString();

type Checkout = z.infer<typeof CheckoutSchema>;
type Order = z.infer<typeof BuyerOrderSchema>;
type Viewing = z.infer<typeof ViewingSchema>;
type Address = z.infer<typeof AddressSchema>;

export const checkoutLine = (
  over: Partial<Checkout['lines'][number]> = {},
): Checkout['lines'][number] => ({
  offerId: 'offer-1',
  productId: 'AID-SOF-0001',
  productName: 'Oslo Sofa',
  sellerName: 'Marina Living',
  quantity: 1,
  quotedUnitPrice: 450_000,
  currentUnitPrice: 450_000,
  status: 'Confirmed',
  ...over,
});

export const checkout = (over: Partial<Checkout> = {}): Checkout => ({
  id: ids.checkout,
  state: 'Ready to Pay',
  lines: [
    checkoutLine(),
    checkoutLine({
      offerId: 'offer-2',
      productName: 'Fjord Table',
      quotedUnitPrice: 120_000,
      currentUnitPrice: 120_000,
    }),
  ],
  total: 570_000,
  depositCredit: 0,
  payable: 570_000,
  expiresAt: inHours(23.5),
  pendingSellerConfirmations: 0,
  orderId: null,
  ...over,
});

export const orderLine = (over: Partial<Order['lines'][number]> = {}): Order['lines'][number] => ({
  id: ids.line,
  productId: 'AID-SOF-0001',
  productName: 'Oslo Sofa',
  quantity: 1,
  unitPriceFils: 450_000,
  grossLineFils: 450_000,
  state: 'Delivered',
  deliveredAt: '2026-10-09T10:00:00.000Z',
  receiptConfirmedAt: null,
  openIssues: [],
  ...over,
});

export const order = (over: Partial<Order> = {}): Order => ({
  id: ids.order,
  placedAt: '2026-10-07T10:00:00.000Z',
  status: 'In Progress',
  grossFils: 570_000,
  depositCreditFils: 20_000,
  paidFils: 550_000,
  payment: { state: 'Captured', capturedAt: '2026-10-07T10:01:00.000Z' },
  estimatedDeliveryBy: '2026-10-14T10:00:00.000Z',
  lines: [
    orderLine(),
    orderLine({
      id: ids.line2,
      productName: 'Fjord Table',
      unitPriceFils: 120_000,
      grossLineFils: 120_000,
      state: 'Preparing',
      deliveredAt: null,
    }),
  ],
  ...over,
});

export const stop = (over: Partial<Viewing['stops'][number]> = {}): Viewing['stops'][number] => ({
  id: ids.stop,
  stopNo: 1,
  partnerName: 'Marina Living',
  locationName: 'Marina Living – Al Quoz',
  address: 'Street 8, Al Quoz Industrial 3, Dubai',
  confirmation: 'Confirmed',
  attendance: null,
  products: [
    {
      offerId: 'offer-1',
      productId: 'AID-SOF-0001',
      name: 'Oslo Sofa',
      quantity: 1,
      unitPrice: 450_000,
    },
  ],
  ...over,
});

export const viewing = (over: Partial<Viewing> = {}): Viewing => ({
  id: ids.viewing,
  state: 'Awaiting Deposit',
  compositionId: ids.composition,
  scheduledAt: null,
  stops: [stop()],
  depositQuote: { base: 450_000, amount: 22_500, capped: false },
  deposit: null,
  needsDecision: false,
  pass: null,
  createdAt: '2026-10-07T10:00:00.000Z',
  ...over,
});

export const customer = {
  id: ids.customer,
  phone: '+971501234567',
  email: null,
  fullName: 'Amal Hassan',
  locale: 'en' as const,
  createdAt: '2026-10-01T10:00:00.000Z',
};

export const me = (): z.infer<typeof MeSchema> => ({
  kind: 'buyer',
  guestSessionId: null,
  customer,
});

export const address = (over: Partial<Address> = {}): Address => ({
  id: ids.address,
  label: 'Home',
  line1: 'Villa 12, Street 4, Al Barsha',
  line2: null,
  area: 'Al Barsha',
  emirate: 'Dubai',
  isDefault: true,
  ...over,
});

export const dataExport = (
  consents: z.infer<typeof DataExportSchema>['consents'] = [],
): z.infer<typeof DataExportSchema> => ({
  exportedAt: '2026-10-07T10:00:00.000Z',
  customer,
  addresses: [],
  consents,
  devices: [],
  projects: [],
  orders: [],
  viewings: [],
});
