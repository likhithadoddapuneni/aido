import {
  ImportDetailSchema,
  ImportJobSchema,
  IssuePageSchema,
  LocationsSchema,
  OfferSchema,
  OffersPageSchema,
  PerformanceSchema,
  PurchaseTasksSchema,
  SellerLinePageSchema,
  SellerProfileSchema,
  SellerProductsSchema,
  StatementDetailSchema,
  StatementPageSchema,
  TeamSchema,
  ViewingTaskSchema,
} from '@aidooi/contracts';
import { z } from 'zod';
import { LOCATION_ID } from './harness.tsx';

/** Every fixture is parsed by the contract schema, so a fixture can never drift from the API. */
const ok = <T extends z.ZodType>(schema: T, value: unknown): z.infer<T> => schema.parse(value);

export const NOW = '2026-10-07T08:00:00.000Z';

export const offer = (over: Record<string, unknown> = {}) =>
  ok(OfferSchema, {
    id: 'AIO-00000001',
    productId: 'AID-00000001',
    productName: 'Oslo 3-seater sofa',
    productType: 'Sofa',
    productDataStatus: 'Verified',
    sku: 'OSL-3',
    sellingPrice: 249_900,
    originalPrice: 299_900,
    stockQty: 8,
    reservedQty: 3,
    availability: 'In Stock',
    deliveryDays: 5,
    viewingStatus: 'On Display',
    viewingConfirmedAt: null,
    locationId: LOCATION_ID,
    status: 'Active',
    version: 4,
    live: true,
    updatedAt: NOW,
    ...over,
  });

export const offersPage = (items = [offer()], nextCursor: string | null = null) =>
  ok(OffersPageSchema, { items, nextCursor });

export const location = {
  id: LOCATION_ID,
  name: 'Dubai showroom',
  address: 'Al Quoz 1',
  emirate: 'Dubai',
  lat: 25.1,
  lng: 55.2,
  openingHours: { mon: [{ open: '10:00', close: '19:00' }] },
  status: 'Active',
};
export const locations = ok(LocationsSchema, { locations: [location] });

export const profile = ok(SellerProfileSchema, {
  code: 'P-0001',
  tradeName: 'Nordic Living',
  legalName: 'Nordic Living LLC',
  status: 'Active',
  contactEmail: 'hello@nordic.test',
  contactPhone: '+97141234567',
  afterSalesTerms: '2 year warranty',
});

export const products = ok(SellerProductsSchema, {
  products: [
    {
      id: 'AID-00000009',
      name: 'Fjord side table',
      type: 'Side Table',
      dataStatus: 'Incomplete',
      missing: ['material'],
      invalid: [],
      widthCm: 40,
      depthCm: 40,
      heightCm: 50,
      primaryColour: 'white',
      primaryStyle: 'scandinavian',
      material: null,
      attributes: {},
      media: [],
    },
  ],
});

export const line = (over: Record<string, unknown> = {}) => ({
  id: '44444444-4444-4444-8444-444444444441',
  orderId: '55555555-5555-4555-8555-555555555551',
  productId: 'AID-00000001',
  productName: 'Oslo 3-seater sofa',
  quantity: 1,
  unitPriceFils: 249_900,
  grossLineFils: 249_900,
  state: 'Confirmed',
  createdAt: NOW,
  deliveredAt: null,
  openIssues: 0,
  delivery: null,
  ...over,
});
export const linesPage = (items = [line()]) =>
  ok(SellerLinePageSchema, { items, nextCursor: null });

export const issuesPage = ok(IssuePageSchema, {
  items: [
    {
      id: '66666666-6666-4666-8666-666666666661',
      orderLineId: '44444444-4444-4444-8444-444444444441',
      flag: 'Damaged',
      state: 'Open',
      note: 'Scratch on the left arm',
      raisedAt: NOW,
      resolvedAt: null,
      resolutionNote: null,
      productName: 'Oslo 3-seater sofa',
    },
  ],
  nextCursor: null,
});

export const purchaseTasks = ok(PurchaseTasksSchema, {
  tasks: [
    {
      id: '77777777-7777-4777-8777-777777777771',
      dueAt: NOW,
      responded: null,
      lines: [
        {
          offerId: 'AIO-00000001',
          productName: 'Oslo 3-seater sofa',
          sellerSku: 'OSL-3',
          quantity: 1,
          unitPrice: 249_900,
          stockQty: 8,
        },
      ],
    },
  ],
});
export const viewingTasks = z.array(ViewingTaskSchema).parse([
  {
    id: '88888888-8888-4888-8888-888888888881',
    viewingRequestId: '99999999-9999-4999-8999-999999999991',
    stopId: '99999999-9999-4999-8999-999999999992',
    dueAt: NOW,
    response: null,
    locationName: 'Dubai showroom',
    products: [
      {
        offerId: 'AIO-00000001',
        productId: 'AID-00000001',
        name: 'Oslo 3-seater sofa',
        quantity: 1,
        unitPrice: 249_900,
        onDisplay: true,
      },
    ],
  },
]);

export const importJob = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  state: 'Validated',
  filename: 'catalogue.csv',
  totalRows: 3,
  errorRows: 1,
  createdCount: null,
  updatedCount: null,
  skippedCount: null,
  createdAt: NOW,
};
export const imports = { imports: [ok(ImportJobSchema, importJob)] };
export const importDetail = ok(ImportDetailSchema, {
  ...importJob,
  rows: [
    { row: 2, status: 'Valid', sku: 'A-1', errors: [] },
    {
      row: 3,
      status: 'Invalid',
      sku: 'B-2',
      errors: [{ path: 'sellingPrice', message: 'Selling price must be positive' }],
    },
    { row: 4, status: 'Valid', sku: 'C-3', errors: [] },
  ],
});

export const statementsPage = ok(StatementPageSchema, {
  items: [
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      runId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
      period: '2026-09',
      state: 'Paid',
      netFils: 1_000_000,
      issuedAt: NOW,
    },
  ],
  nextCursor: null,
});
export const statementDetail = ok(StatementDetailSchema, {
  ...statementsPage.items[0],
  taxInvoiceNo: 'TI-1',
  grossFils: 1_100_000,
  commissionFils: 100_000,
  adjustmentFils: 0,
  lines: [
    {
      orderLineId: '44444444-4444-4444-8444-444444444441',
      kind: 'Sale',
      productName: 'Oslo 3-seater sofa',
      grossFils: 1_100_000,
      commissionFils: 100_000,
      netFils: 1_000_000,
    },
  ],
});

export const team = ok(TeamSchema, {
  members: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'sara@seller.test',
      fullName: 'Sara Seller',
      role: 'seller_owner',
      status: 'Active',
      locationId: null,
    },
    {
      id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
      email: 'omar@seller.test',
      fullName: 'Omar Staff',
      role: 'seller_staff',
      status: 'Active',
      locationId: LOCATION_ID,
    },
  ],
});

export const performance = ok(PerformanceSchema, {
  period: '30d',
  from: NOW,
  to: NOW,
  confirmation: {
    purchase: { requests: 10, confirmed: 9, rate: 0.9 },
    viewing: { requests: 4, confirmed: 4, rate: 1 },
    responseSeconds: { median: 600, p90: 5400 },
  },
  fulfilment: { dueLines: 8, onTime: 7, onTimeRate: 0.875 },
  issues: { lines: 8, issues: 1, issueRate: 0.125 },
});
