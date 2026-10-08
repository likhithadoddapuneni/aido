import { z } from 'zod';
import { FilsSchema, InstantSchema, PageQuerySchema, UuidSchema, pageOf } from './common.ts';

/** HTTP contracts of the ops back-office API (`/v1/ops/**`). */

export const OpsIdParamsSchema = z.object({ id: UuidSchema });
const Search = z.string().trim().min(1).max(100).optional();
const Reason = z.string().trim().min(3).max(500);

/* ------------------------------ partners (AID-LOG-013) ------------------------------ */

export const PARTNER_STATUSES = [
  'Requested',
  'Under Review',
  'Approved/Agreement Pending',
  'Active',
  'Inactive',
] as const;

export const OpsPartnerSchema = z.object({
  id: UuidSchema,
  code: z.string(),
  legalName: z.string(),
  tradeName: z.string(),
  taxRegistrationNo: z.string().nullable(),
  status: z.enum(PARTNER_STATUSES),
  /** Basis points: 1400 = 14%. Applies to offers' snapshots going forward; locked snapshots never change. */
  commissionBps: z.number().int().min(0).max(10_000),
  afterSalesTerms: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  activatedAt: InstantSchema.nullable(),
  createdAt: InstantSchema,
});

const PartnerFields = {
  legalName: z.string().trim().min(2).max(200),
  tradeName: z.string().trim().min(2).max(120),
  taxRegistrationNo: z.string().trim().max(40).nullable(),
  commissionBps: z.number().int().min(0).max(10_000),
  afterSalesTerms: z.string().trim().max(2000).nullable(),
  contactEmail: z.email().nullable(),
  contactPhone: z
    .string()
    .regex(/^\+[1-9][0-9]{7,14}$/)
    .nullable(),
};
export const CreatePartnerBodySchema = z.object({
  ...PartnerFields,
  taxRegistrationNo: PartnerFields.taxRegistrationNo.default(null),
  afterSalesTerms: PartnerFields.afterSalesTerms.default(null),
  contactEmail: PartnerFields.contactEmail.default(null),
  contactPhone: PartnerFields.contactPhone.default(null),
});
export const PatchPartnerBodySchema = z
  .object(PartnerFields)
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');
export const PartnerListQuerySchema = PageQuerySchema.extend({
  status: z.enum(PARTNER_STATUSES).optional(),
  search: Search,
});
export const OpsPartnerPageSchema = pageOf(OpsPartnerSchema);

export const PartnerTransitionBodySchema = z.object({
  to: z.enum(PARTNER_STATUSES),
  reason: Reason,
  /** Deactivate despite undelivered order lines. ops_admin only, and the reason is kept. */
  force: z.boolean().default(false),
});
export const OwnerInvitationBodySchema = z.object({
  email: z.email(),
  fullName: z.string().trim().min(2).max(120),
  locationId: UuidSchema.nullable().default(null),
  phone: z
    .string()
    .regex(/^\+[1-9][0-9]{7,14}$/)
    .nullable()
    .default(null),
});
export const OwnerInvitationResultSchema = z.object({
  userId: UuidSchema,
  expiresAt: InstantSchema,
});

/** What must be true before a partner may trade, each condition and whether it holds right now. */
export const ActivationChecklistSchema = z.object({
  items: z.array(
    z.object({
      key: z.enum(['location', 'owner', 'commission', 'afterSales']),
      met: z.boolean(),
    }),
  ),
  ready: z.boolean(),
});

export const OpsTeamMemberSchema = z.object({
  id: UuidSchema,
  email: z.string(),
  fullName: z.string(),
  role: z.enum(['seller_owner', 'seller_manager', 'seller_staff']),
  status: z.enum(['Invited', 'Active', 'Disabled']),
  mfaEnrolled: z.boolean(),
});
export const OpsTeamSchema = z.object({ members: z.array(OpsTeamMemberSchema) });

/* ------------------------------ product verification (AID-DATA-014) ------------------------------ */

export const CompletenessSchema = z.object({
  missing: z.array(z.string()),
  invalid: z.array(z.string()),
  complete: z.boolean(),
});

export const OpsProductQuerySchema = PageQuerySchema.extend({
  status: z.enum(['Incomplete', 'Ready for Review', 'Verified']).default('Ready for Review'),
  partnerId: UuidSchema.optional(),
  type: z.string().max(60).optional(),
  search: Search,
});

export const OpsProductSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  dataStatus: z.enum(['Incomplete', 'Ready for Review', 'Verified']),
  lifecycle: z.enum(['Active', 'Inactive']),
  updatedAt: InstantSchema,
  completeness: CompletenessSchema,
  partners: z.array(z.object({ id: UuidSchema, tradeName: z.string() })),
});
export const OpsProductPageSchema = pageOf(OpsProductSummarySchema);

const Attr = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));
export const OpsProductDetailSchema = OpsProductSummarySchema.extend({
  parentId: z.string(),
  widthCm: z.number().int().nullable(),
  depthCm: z.number().int().nullable(),
  heightCm: z.number().int().nullable(),
  primaryColour: z.string().nullable(),
  secondaryColour: z.string().nullable(),
  material: z.string().nullable(),
  primaryStyle: z.string().nullable(),
  secondaryStyle: z.string().nullable(),
  attributes: Attr,
  verifiedAt: InstantSchema.nullable(),
  offers: z.array(
    z.object({
      id: z.string(),
      partnerId: UuidSchema,
      sellingPrice: FilsSchema,
      availability: z.string(),
      stockQty: z.number().int(),
      status: z.string(),
    }),
  ),
  history: z.array(
    z.object({
      at: InstantSchema,
      from: z.string().nullable(),
      to: z.string().nullable(),
      actorType: z.string(),
      actorId: z.string().nullable(),
      reason: z.string().nullable(),
    }),
  ),
});

export const OpsProductParamsSchema = z.object({ id: z.string().regex(/^AID-\d{8}$/) });
export const PatchProductBodySchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    type: z.string().trim().min(2).max(60),
    widthCm: z.number().int().min(1).max(1000),
    depthCm: z.number().int().min(1).max(1000),
    heightCm: z.number().int().min(1).max(1000),
    primaryColour: z.string(),
    secondaryColour: z.string().nullable(),
    material: z.string(),
    primaryStyle: z.string(),
    secondaryStyle: z.string().nullable(),
    attributes: Attr,
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');
export const RejectProductBodySchema = z.object({
  reasons: z.array(z.string().trim().min(3).max(300)).min(1).max(10),
});

export const ProductStatsSchema = z.object({
  queue: z.object({
    readyForReview: z.number().int(),
    incomplete: z.number().int(),
    medianAgeHours: z.number().nullable(),
  }),
  rejectionByPartner: z.array(
    z.object({
      partnerId: UuidSchema,
      tradeName: z.string(),
      rejected: z.number().int(),
      verified: z.number().int(),
      rejectionRate: z.number(),
    }),
  ),
});

/* ------------------------------ compatibility-map governance (gap 5) ------------------------------ */

export const MAP_KINDS = ['style', 'colour', 'material'] as const;
export const CompatMapStatusSchema = z.object({
  kind: z.enum(MAP_KINDS),
  codeVersion: z.string(),
  codeHash: z.string(),
  /** approved = the deployed maps are approved and active; the engine will run. */
  state: z.enum(['approved', 'unapproved', 'mismatch', 'retired']),
  versions: z.array(
    z.object({
      version: z.string(),
      hash: z.string(),
      matchesDeployedCode: z.boolean(),
      approvedBy: UuidSchema,
      activatedAt: InstantSchema.nullable(),
      retiredAt: InstantSchema.nullable(),
    }),
  ),
});
export const CompatMapsSchema = z.object({ maps: z.array(CompatMapStatusSchema) });
export const MapKindParamsSchema = z.object({ kind: z.enum(MAP_KINDS) });
export const ApproveMapBodySchema = z.object({
  version: z.string().min(3).max(40),
  reviewNote: Reason,
});
export const RetireMapBodySchema = z.object({ version: z.string().min(3).max(40), reason: Reason });

/* ------------------------------ orders & customers (support desk) ------------------------------ */

export const OpsOrderQuerySchema = PageQuerySchema.extend({
  search: Search,
  partnerId: UuidSchema.optional(),
  status: z
    .enum(['Confirmed', 'In Progress', 'Issue Reported', 'Completed', 'Cancelled'])
    .optional(),
});
export const OpsOrderSummarySchema = z.object({
  id: UuidSchema,
  placedAt: InstantSchema,
  customerId: UuidSchema,
  grossFils: FilsSchema,
  paidFils: FilsSchema,
  status: z.enum(['Confirmed', 'In Progress', 'Issue Reported', 'Completed', 'Cancelled']),
  lineCount: z.number().int(),
});
export const OpsOrderPageSchema = pageOf(OpsOrderSummarySchema);

export const OpsOrderDetailSchema = z.object({
  order: OpsOrderSummarySchema.extend({
    depositCreditFils: FilsSchema,
    viewingRequestId: UuidSchema.nullable(),
  }),
  delivery: z
    .object({
      recipientName: z.string(),
      phone: z.string(),
      line1: z.string(),
      line2: z.string().nullable(),
      area: z.string().nullable(),
      emirate: z.string(),
      instructions: z.string().nullable(),
    })
    .nullable(),
  sellerOrders: z.array(
    z.object({
      id: UuidSchema,
      partnerId: UuidSchema,
      tradeName: z.string(),
      subtotalFils: FilsSchema,
    }),
  ),
  lines: z.array(
    z.object({
      id: UuidSchema,
      sellerOrderId: UuidSchema,
      productId: z.string(),
      productName: z.string(),
      quantity: z.number().int(),
      unitPriceFils: FilsSchema,
      grossLineFils: FilsSchema,
      commissionFils: FilsSchema,
      state: z.string(),
      settlementState: z.string(),
    }),
  ),
  payment: z
    .object({
      id: UuidSchema,
      state: z.string(),
      amountFils: FilsSchema,
      providerRef: z.string().nullable(),
    })
    .nullable(),
  refunds: z.array(
    z.object({
      id: UuidSchema,
      amountFils: FilsSchema,
      state: z.string(),
      reason: z.string(),
      orderLineId: UuidSchema.nullable(),
    }),
  ),
  ledger: z.array(
    z.object({
      entryGroup: UuidSchema,
      at: InstantSchema,
      account: z.string(),
      direction: z.enum(['debit', 'credit']),
      amountFils: FilsSchema,
      memo: z.string().nullable(),
    }),
  ),
  notes: z.array(
    z.object({ id: UuidSchema, opsUserId: UuidSchema, body: z.string(), createdAt: InstantSchema }),
  ),
  audit: z.array(
    z.object({
      at: InstantSchema,
      entityType: z.string(),
      entityId: z.string(),
      fromState: z.string().nullable(),
      toState: z.string().nullable(),
      actorType: z.string(),
      reason: z.string().nullable(),
    }),
  ),
});
export const OrderNoteBodySchema = z.object({ body: z.string().trim().min(1).max(2000) });
export const OrderNoteSchema = z.object({
  id: UuidSchema,
  opsUserId: UuidSchema,
  body: z.string(),
  createdAt: InstantSchema,
});

export const OpsCustomerSchema = z.object({
  id: UuidSchema,
  status: z.enum(['Active', 'Erased']),
  locale: z.enum(['en', 'ar']),
  fullName: z.string().nullable(),
  /** Masked: enough to recognise the customer on a call, not enough to misuse. */
  phoneMasked: z.string().nullable(),
  emailMasked: z.string().nullable(),
  createdAt: InstantSchema,
  orderCount: z.number().int(),
});

export const OpsViewingQuerySchema = PageQuerySchema.extend({
  state: z
    .enum([
      'Draft',
      'Awaiting Seller Confirmation',
      'Awaiting Deposit',
      'Confirmed',
      'Completed',
      'No-show',
      'Cancelled',
    ])
    .optional(),
  partnerId: UuidSchema.optional(),
});
export const OpsViewingSummarySchema = z.object({
  id: UuidSchema,
  state: z.string(),
  customerId: UuidSchema,
  scheduledAt: InstantSchema.nullable(),
  createdAt: InstantSchema,
  stopCount: z.number().int(),
  depositFils: FilsSchema.nullable(),
  depositState: z.string().nullable(),
});
export const OpsViewingPageSchema = pageOf(OpsViewingSummarySchema);
export const OpsViewingDetailSchema = OpsViewingSummarySchema.extend({
  stops: z.array(
    z.object({
      id: UuidSchema,
      partnerId: UuidSchema,
      tradeName: z.string(),
      confirmationState: z.string(),
      products: z.array(
        z.object({
          offerId: z.string(),
          productId: z.string(),
          quantity: z.number().int(),
          unitPriceFils: FilsSchema,
        }),
      ),
    }),
  ),
  attribution: z.array(z.object({ stage: z.string(), at: InstantSchema })),
});

/* ------------------------------ staff ------------------------------ */

export const OPS_ROLES = ['ops_admin', 'ops_catalogue', 'ops_support', 'ops_finance'] as const;
export const OpsStaffSchema = z.object({
  id: UuidSchema,
  email: z.string(),
  fullName: z.string(),
  role: z.enum(OPS_ROLES),
  status: z.enum(['Active', 'Disabled']),
  mfaEnrolled: z.boolean(),
  /** False until the invitation is accepted: such a user cannot sign in. */
  hasCredential: z.boolean(),
});
export const OpsStaffListSchema = z.object({ staff: z.array(OpsStaffSchema) });
export const InviteStaffBodySchema = z.object({
  email: z.email(),
  fullName: z.string().trim().min(2).max(120),
  role: z.enum(OPS_ROLES),
});
export const InviteStaffResultSchema = z.object({ userId: UuidSchema, expiresAt: InstantSchema });
export const PatchStaffBodySchema = z
  .object({ role: z.enum(OPS_ROLES), status: z.enum(['Active', 'Disabled']) })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');
export const MfaResetBodySchema = z.object({ reason: Reason });
export const MfaResetResultSchema = z.object({ revokedSessions: z.number().int() });

/* ------------------------------ audit, flags, overview ------------------------------ */

export const OpsAuditQuerySchema = PageQuerySchema.extend({
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(100).optional(),
  actorId: z.string().max(100).optional(),
  from: InstantSchema.optional(),
  to: InstantSchema.optional(),
});
export const OpsAuditEventSchema = z.object({
  id: UuidSchema,
  at: InstantSchema,
  entityType: z.string(),
  entityId: z.string(),
  fromState: z.string().nullable(),
  toState: z.string().nullable(),
  actorType: z.string(),
  actorId: z.string().nullable(),
  reason: z.string().nullable(),
  correlationId: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
});
export const OpsAuditPageSchema = pageOf(OpsAuditEventSchema);

export const FlagKeyParamsSchema = z.object({ key: z.string().regex(/^[a-z][a-z0-9_.-]{1,60}$/) });
export const FeatureFlagSchema = z.object({
  key: z.string(),
  enabled: z.boolean(),
  rolloutPct: z.number().int().min(0).max(100),
  description: z.string().nullable(),
  updatedAt: InstantSchema,
});
export const PutFeatureFlagBodySchema = z.object({
  enabled: z.boolean(),
  rolloutPct: z.number().int().min(0).max(100).default(100),
  description: z.string().max(300).nullable().default(null),
});
export const FeatureFlagListSchema = z.object({ flags: z.array(FeatureFlagSchema) });

export const OverviewSchema = z.object({
  asOf: InstantSchema,
  verificationQueue: z.number().int(),
  openIssues: z.number().int(),
  confirmationsPastHalfSla: z.number().int(),
  paymentsStuckAuthorized: z.number().int(),
  settlementRunsAwaitingApproval: z.number().int(),
});
