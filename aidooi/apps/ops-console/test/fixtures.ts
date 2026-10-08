import {
  ActivationChecklistSchema,
  CompatMapsSchema,
  CreateRunResponseSchema,
  FeatureFlagListSchema,
  IssuePageSchema,
  OpsAuditPageSchema,
  OpsCustomerSchema,
  OpsOrderDetailSchema,
  OpsOrderPageSchema,
  OpsPartnerPageSchema,
  OpsPartnerSchema,
  OpsProductDetailSchema,
  OpsProductPageSchema,
  OpsStaffListSchema,
  OpsTeamSchema,
  OpsViewingDetailSchema,
  OpsViewingPageSchema,
  OverviewSchema,
  ProductStatsSchema,
  RunPageSchema,
} from '@aidooi/contracts';
import type { z } from 'zod';

/** Every fixture is parsed by the contract schema, so a fixture can never drift from the API. */
const ok = <T extends z.ZodType>(schema: T, value: unknown): z.output<T> => schema.parse(value);

export const NOW = '2026-10-07T08:00:00.000Z';
export const id = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
export const PARTNER_ID = id(1);
const USER_ID = id(2);

export const overview = (over: Record<string, unknown> = {}) =>
  ok(OverviewSchema, {
    asOf: NOW,
    verificationQueue: 4,
    openIssues: 2,
    confirmationsPastHalfSla: 0,
    paymentsStuckAuthorized: 1,
    settlementRunsAwaitingApproval: 3,
    ...over,
  });

export const partner = (over: Record<string, unknown> = {}) =>
  ok(OpsPartnerSchema, {
    id: PARTNER_ID,
    code: 'P-0001',
    legalName: 'Al Noor Furniture LLC',
    tradeName: 'Al Noor',
    taxRegistrationNo: '100123456700003',
    status: 'Under Review',
    commissionBps: 1400,
    afterSalesTerms: null,
    contactEmail: 'hello@alnoor.test',
    contactPhone: '+971501234567',
    activatedAt: null,
    createdAt: NOW,
    ...over,
  });
export const partnerPage = (items = [partner()]) =>
  ok(OpsPartnerPageSchema, { items, nextCursor: null });

export const checklist = (
  met: Partial<Record<'location' | 'owner' | 'commission' | 'afterSales', boolean>> = {},
) => {
  const items = (['location', 'owner', 'commission', 'afterSales'] as const).map((key) => ({
    key,
    met: met[key] ?? false,
  }));
  return ok(ActivationChecklistSchema, { items, ready: items.every((i) => i.met) });
};

export const team = () =>
  ok(OpsTeamSchema, {
    members: [
      {
        id: USER_ID,
        email: 'owner@alnoor.test',
        fullName: 'Omar Owner',
        role: 'seller_owner',
        status: 'Active',
        mfaEnrolled: true,
      },
    ],
  });

const completeness = (missing: string[] = [], invalid: string[] = []) => ({
  missing,
  invalid,
  complete: missing.length + invalid.length === 0,
});
export const PRODUCT_ID = 'AID-00000001';
export const productRow = (over: Record<string, unknown> = {}) => ({
  id: PRODUCT_ID,
  name: 'Oslo 3-seater sofa',
  type: 'Sofa',
  dataStatus: 'Ready for Review',
  lifecycle: 'Active',
  updatedAt: NOW,
  completeness: completeness(),
  partners: [{ id: PARTNER_ID, tradeName: 'Al Noor' }],
  ...over,
});
export const productPage = (items = [productRow()]) =>
  ok(OpsProductPageSchema, { items, nextCursor: null });
export const productStats = () =>
  ok(ProductStatsSchema, {
    queue: { readyForReview: 4, incomplete: 2, medianAgeHours: 6 },
    rejectionByPartner: [
      {
        partnerId: PARTNER_ID,
        tradeName: 'Al Noor',
        rejected: 1,
        verified: 3,
        rejectionRate: 0.25,
      },
    ],
  });
export const productDetail = (over: Record<string, unknown> = {}) =>
  ok(OpsProductDetailSchema, {
    ...productRow(),
    parentId: PRODUCT_ID,
    widthCm: 210,
    depthCm: 95,
    heightCm: 85,
    primaryColour: 'Grey',
    secondaryColour: null,
    material: 'Fabric',
    primaryStyle: 'Modern',
    secondaryStyle: null,
    attributes: { seats: 3, washable: true },
    verifiedAt: null,
    offers: [
      {
        id: 'AIO-00000001',
        partnerId: PARTNER_ID,
        sellingPrice: 349_900,
        availability: 'In Stock',
        stockQty: 5,
        status: 'Active',
      },
    ],
    history: [
      {
        at: NOW,
        from: 'Incomplete',
        to: 'Ready for Review',
        actorType: 'partner',
        actorId: null,
        reason: null,
      },
    ],
    ...over,
  });

const version = (over: Record<string, unknown> = {}) => ({
  version: 'v3',
  hash: 'abc123',
  matchesDeployedCode: true,
  approvedBy: USER_ID,
  activatedAt: NOW,
  retiredAt: null,
  ...over,
});
export const compatMaps = (state: 'approved' | 'unapproved' = 'unapproved') =>
  ok(CompatMapsSchema, {
    maps: [
      { kind: 'style', codeVersion: 'v4', codeHash: 'def456', state, versions: [version()] },
      {
        kind: 'colour',
        codeVersion: 'v3',
        codeHash: 'abc123',
        state: 'approved',
        versions: [version()],
      },
      { kind: 'material', codeVersion: 'v1', codeHash: '999aaa', state: 'mismatch', versions: [] },
    ],
  });

export const ORDER_ID = id(10);
export const CUSTOMER_ID = id(11);
export const orderSummary = (over: Record<string, unknown> = {}) => ({
  id: ORDER_ID,
  placedAt: NOW,
  customerId: CUSTOMER_ID,
  grossFils: 349_900,
  paidFils: 349_900,
  status: 'In Progress',
  lineCount: 1,
  ...over,
});
export const orderPage = () =>
  ok(OpsOrderPageSchema, { items: [orderSummary()], nextCursor: null });
export const orderDetail = () =>
  ok(OpsOrderDetailSchema, {
    order: { ...orderSummary(), depositCreditFils: 5_000, viewingRequestId: null },
    delivery: {
      recipientName: 'Layla Buyer',
      phone: '+971501112222',
      line1: 'Villa 4',
      line2: null,
      area: 'Al Barsha',
      emirate: 'Dubai',
      instructions: null,
    },
    sellerOrders: [
      { id: id(12), partnerId: PARTNER_ID, tradeName: 'Al Noor', subtotalFils: 349_900 },
    ],
    lines: [
      {
        id: id(13),
        sellerOrderId: id(12),
        productId: PRODUCT_ID,
        productName: 'Oslo 3-seater sofa',
        quantity: 1,
        unitPriceFils: 349_900,
        grossLineFils: 349_900,
        commissionFils: 48_986,
        state: 'Confirmed',
        settlementState: 'Not Eligible',
      },
    ],
    payment: { id: id(14), state: 'Succeeded', amountFils: 349_900, providerRef: 'mock_pay_1' },
    refunds: [],
    ledger: [
      {
        entryGroup: id(15),
        at: NOW,
        account: 'escrow',
        direction: 'credit',
        amountFils: 349_900,
        memo: null,
      },
    ],
    notes: [{ id: id(16), opsUserId: USER_ID, body: 'Called the buyer.', createdAt: NOW }],
    audit: [
      {
        at: NOW,
        entityType: 'order',
        entityId: ORDER_ID,
        fromState: null,
        toState: 'Confirmed',
        actorType: 'system',
        reason: null,
      },
    ],
  });
export const customer = () =>
  ok(OpsCustomerSchema, {
    id: CUSTOMER_ID,
    status: 'Active',
    locale: 'en',
    fullName: 'Layla Buyer',
    phoneMasked: '+9715•••••22',
    emailMasked: 'l•••@example.test',
    createdAt: NOW,
    orderCount: 2,
  });

export const VIEWING_ID = id(20);
export const viewingPage = () =>
  ok(OpsViewingPageSchema, {
    items: [
      {
        id: VIEWING_ID,
        state: 'Confirmed',
        customerId: CUSTOMER_ID,
        scheduledAt: NOW,
        createdAt: NOW,
        stopCount: 1,
        depositFils: 5_000,
        depositState: 'Held',
      },
    ],
    nextCursor: null,
  });
export const viewingDetail = () =>
  ok(OpsViewingDetailSchema, {
    ...viewingPage().items[0],
    stops: [
      {
        id: id(21),
        partnerId: PARTNER_ID,
        tradeName: 'Al Noor',
        confirmationState: 'Confirmed',
        products: [
          { offerId: 'AIO-00000001', productId: PRODUCT_ID, quantity: 1, unitPriceFils: 349_900 },
        ],
      },
    ],
    attribution: [{ stage: 'created', at: NOW }],
  });

export const ISSUE_ID = id(30);
export const issuePage = () =>
  ok(IssuePageSchema, {
    items: [
      {
        id: ISSUE_ID,
        orderLineId: id(13),
        flag: 'Damaged',
        state: 'Open',
        note: 'Scratched arm',
        raisedAt: NOW,
        resolvedAt: null,
        resolutionNote: null,
        productName: 'Oslo 3-seater sofa',
      },
    ],
    nextCursor: null,
  });

export const RUN_ID = id(40);
export const run = (over: Record<string, unknown> = {}) => ({
  id: RUN_ID,
  partnerId: PARTNER_ID,
  partnerName: 'Al Noor',
  period: '2026-09',
  state: 'Draft',
  grossFils: 1_000_000,
  commissionFils: 140_000,
  adjustmentFils: 0,
  netFils: 860_000,
  approvedAt: null,
  paidAt: null,
  payoutRef: null,
  ...over,
});
export const runPage = (items = [run()]) => ok(RunPageSchema, { items, nextCursor: null });
export const createdRuns = () =>
  ok(CreateRunResponseSchema, {
    period: '2026-09',
    runs: [run()],
    held: [{ partnerId: PARTNER_ID, grossFils: 120_000 }],
  });

export const staff = () =>
  ok(OpsStaffListSchema, {
    staff: [
      {
        id: ME_ID_FOR_STAFF,
        email: 'olu@aidooi.test',
        fullName: 'Olu Ops',
        role: 'ops_admin',
        status: 'Active',
        mfaEnrolled: true,
        hasCredential: true,
      },
      {
        id: id(50),
        email: 'fin@aidooi.test',
        fullName: 'Fiona Finance',
        role: 'ops_finance',
        status: 'Active',
        mfaEnrolled: true,
        hasCredential: true,
      },
    ],
  });
export const ME_ID_FOR_STAFF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

export const auditPage = () =>
  ok(OpsAuditPageSchema, {
    items: [
      {
        id: id(60),
        at: NOW,
        entityType: 'partner',
        entityId: PARTNER_ID,
        fromState: 'Under Review',
        toState: 'Active',
        actorType: 'ops',
        actorId: ME_ID_FOR_STAFF,
        reason: 'Agreement signed',
        correlationId: 'corr-1',
        data: {},
      },
    ],
    nextCursor: null,
  });

export const flags = () =>
  ok(FeatureFlagListSchema, {
    flags: [
      {
        key: 'new_checkout',
        enabled: true,
        rolloutPct: 50,
        description: 'Staged rollout',
        updatedAt: NOW,
      },
    ],
  });
