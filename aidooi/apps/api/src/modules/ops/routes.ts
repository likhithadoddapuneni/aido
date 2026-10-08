import {
  ActivationChecklistSchema,
  ApproveMapBodySchema,
  CompatMapStatusSchema,
  CompatMapsSchema,
  CreatePartnerBodySchema,
  FeatureFlagListSchema,
  FeatureFlagSchema,
  FlagKeyParamsSchema,
  InviteStaffBodySchema,
  InviteStaffResultSchema,
  MapKindParamsSchema,
  MfaResetBodySchema,
  MfaResetResultSchema,
  OpsAuditPageSchema,
  OpsAuditQuerySchema,
  OpsCustomerSchema,
  OpsIdParamsSchema,
  OpsOrderDetailSchema,
  OpsOrderPageSchema,
  OpsOrderQuerySchema,
  OpsPartnerPageSchema,
  OpsPartnerSchema,
  OpsProductDetailSchema,
  OpsProductPageSchema,
  OpsProductParamsSchema,
  OpsProductQuerySchema,
  OpsStaffListSchema,
  OpsStaffSchema,
  OpsTeamSchema,
  OpsViewingDetailSchema,
  OpsViewingPageSchema,
  OpsViewingQuerySchema,
  OrderNoteBodySchema,
  OrderNoteSchema,
  OverviewSchema,
  OwnerInvitationBodySchema,
  OwnerInvitationResultSchema,
  PartnerListQuerySchema,
  PartnerTransitionBodySchema,
  PatchPartnerBodySchema,
  PatchProductBodySchema,
  PatchStaffBodySchema,
  ProductStatsSchema,
  PutFeatureFlagBodySchema,
  RejectProductBodySchema,
  RetireMapBodySchema,
  errorsFor,
} from '@aidooi/contracts';
import type { ModuleRoutes } from '../registry.ts';
import { approveMap, listMaps, retireMap } from './compat.ts';
import {
  addOrderNote,
  customerSummary,
  listOrders,
  listViewings,
  orderDetail,
  viewingDetail,
} from './desk.ts';
import {
  createPartner,
  getPartner,
  inviteOwner,
  listPartners,
  partnerActivationChecklist,
  partnerTeam,
  patchPartner,
  transitionPartner,
} from './partners.ts';
import { auditEvents, getFlag, listFlags, overview, putFlag } from './platform.ts';
import {
  patchProduct,
  productDetail,
  productQueue,
  productStats,
  rejectProduct,
  setLifecycle,
  verifyProduct,
} from './products.ts';
import { inviteStaff, listStaff, patchStaff, resetMfa } from './staff.ts';

const sec = [{ bearer: [] }];
const E = errorsFor;

/** The operations back office. Authorisation per route lives with the handlers (`guard` + `ROLES`). */
export const opsRoutes: ModuleRoutes = async (app, ctx) => {
  const t = (tag: string, summary: string) => ({ tags: [`ops ${tag}`], security: sec, summary });

  /* ------------------------------ partners ------------------------------ */
  app.get(
    '/v1/ops/partners',
    {
      schema: {
        ...t('partners', 'Partners'),
        querystring: PartnerListQuerySchema,
        response: { 200: OpsPartnerPageSchema, ...E(400, 401, 403) },
      },
    },
    (req) => listPartners(ctx, req, req.query),
  );
  app.post(
    '/v1/ops/partners',
    {
      schema: {
        ...t('partners', 'Create a partner in Requested'),
        body: CreatePartnerBodySchema,
        response: { 201: OpsPartnerSchema, ...E(400, 401, 403) },
      },
    },
    async (req, reply) => reply.code(201).send(await createPartner(ctx, req, req.body)),
  );
  app.get(
    '/v1/ops/partners/:id',
    {
      schema: {
        ...t('partners', 'A partner'),
        params: OpsIdParamsSchema,
        response: { 200: OpsPartnerSchema, ...E(401, 403, 404) },
      },
    },
    (req) => getPartner(ctx, req, req.params.id),
  );
  app.get(
    '/v1/ops/partners/:id/activation-checklist',
    {
      schema: {
        ...t('partners', 'What still stands between this partner and activation'),
        params: OpsIdParamsSchema,
        response: { 200: ActivationChecklistSchema, ...E(401, 403, 404) },
      },
    },
    (req) => partnerActivationChecklist(ctx, req, req.params.id),
  );
  app.patch(
    '/v1/ops/partners/:id',
    {
      schema: {
        ...t(
          'partners',
          'Edit ops-owned partner fields. A commission change affects future orders only.',
        ),
        params: OpsIdParamsSchema,
        body: PatchPartnerBodySchema,
        response: { 200: OpsPartnerSchema, ...E(400, 401, 403, 404) },
      },
    },
    (req) => patchPartner(ctx, req, req.params.id, req.body),
  );
  app.post(
    '/v1/ops/partners/:id/transition',
    {
      schema: {
        ...t(
          'partners',
          'Move a partner through its lifecycle (AID-LOG-013). Activation and deactivation are administrator-only.',
        ),
        params: OpsIdParamsSchema,
        body: PartnerTransitionBodySchema,
        response: { 200: OpsPartnerSchema, ...E(400, 401, 403, 404, 409, 422) },
      },
    },
    (req) => transitionPartner(ctx, req, req.params.id, req.body),
  );
  app.post(
    '/v1/ops/partners/:id/owner-invitation',
    {
      schema: {
        ...t(
          'partners',
          'Invite the partner’s owner. The invitation travels by notification, never in this response.',
        ),
        params: OpsIdParamsSchema,
        body: OwnerInvitationBodySchema,
        response: { 201: OwnerInvitationResultSchema, ...E(400, 401, 403, 404, 409) },
      },
    },
    async (req, reply) =>
      reply.code(201).send(await inviteOwner(ctx, req, req.params.id, req.body)),
  );
  app.get(
    '/v1/ops/partners/:id/team',
    {
      schema: {
        ...t('partners', 'A partner’s users'),
        params: OpsIdParamsSchema,
        response: { 200: OpsTeamSchema, ...E(401, 403, 404) },
      },
    },
    (req) => partnerTeam(ctx, req, req.params.id),
  );

  /* ------------------------------ products ------------------------------ */
  app.get(
    '/v1/ops/products',
    {
      schema: {
        ...t('products', 'Verification queue (AID-DATA-014)'),
        querystring: OpsProductQuerySchema,
        response: { 200: OpsProductPageSchema, ...E(400, 401, 403) },
      },
    },
    (req) => productQueue(ctx, req, req.query),
  );
  app.get(
    '/v1/ops/products/stats',
    {
      schema: {
        ...t('products', 'Verification throughput'),
        response: { 200: ProductStatsSchema, ...E(401, 403) },
      },
    },
    (req) => productStats(ctx, req),
  );
  app.get(
    '/v1/ops/products/:id',
    {
      schema: {
        ...t('products', 'Product with offers and change history'),
        params: OpsProductParamsSchema,
        response: { 200: OpsProductDetailSchema, ...E(401, 403, 404) },
      },
    },
    (req) => productDetail(ctx, req, req.params.id),
  );
  app.patch(
    '/v1/ops/products/:id',
    {
      schema: {
        ...t('products', 'Correct a product. Editing a Verified product returns it to review.'),
        params: OpsProductParamsSchema,
        body: PatchProductBodySchema,
        response: { 200: OpsProductDetailSchema, ...E(400, 401, 403, 404, 422) },
      },
    },
    (req) => patchProduct(ctx, req, req.params.id, req.body),
  );
  app.post(
    '/v1/ops/products/:id/verify',
    {
      schema: {
        ...t('products', 'Verify a complete product'),
        params: OpsProductParamsSchema,
        response: { 200: OpsProductDetailSchema, ...E(401, 403, 404, 422) },
      },
    },
    (req) => verifyProduct(ctx, req, req.params.id),
  );
  app.post(
    '/v1/ops/products/:id/reject',
    {
      schema: {
        ...t('products', 'Send a product back to the seller with reasons'),
        params: OpsProductParamsSchema,
        body: RejectProductBodySchema,
        response: { 200: OpsProductDetailSchema, ...E(400, 401, 403, 404, 422) },
      },
    },
    (req) => rejectProduct(ctx, req, req.params.id, req.body),
  );
  app.post(
    '/v1/ops/products/:id/deactivate',
    {
      schema: {
        ...t('products', 'Take a product out of circulation'),
        params: OpsProductParamsSchema,
        response: { 200: OpsProductDetailSchema, ...E(401, 403, 404) },
      },
    },
    (req) => setLifecycle(ctx, req, req.params.id, 'Inactive'),
  );
  app.post(
    '/v1/ops/products/:id/activate',
    {
      schema: {
        ...t('products', 'Return a product to circulation'),
        params: OpsProductParamsSchema,
        response: { 200: OpsProductDetailSchema, ...E(401, 403, 404) },
      },
    },
    (req) => setLifecycle(ctx, req, req.params.id, 'Active'),
  );

  /* ------------------------------ compatibility maps ------------------------------ */
  app.get(
    '/v1/ops/compat-maps',
    {
      schema: {
        ...t('compat-maps', 'Deployed maps against approved maps'),
        response: { 200: CompatMapsSchema, ...E(401, 403) },
      },
    },
    (req) => listMaps(ctx, req),
  );
  app.post(
    '/v1/ops/compat-maps/:kind/approve',
    {
      schema: {
        ...t(
          'compat-maps',
          'Approve the deployed map (administrators). Until approved, the engine will not run.',
        ),
        params: MapKindParamsSchema,
        body: ApproveMapBodySchema,
        response: { 200: CompatMapStatusSchema, ...E(400, 401, 403, 409, 422) },
      },
    },
    (req) => approveMap(ctx, req, req.params.kind, req.body),
  );
  app.post(
    '/v1/ops/compat-maps/:kind/retire',
    {
      schema: {
        ...t('compat-maps', 'Retire an approved map (administrators)'),
        params: MapKindParamsSchema,
        body: RetireMapBodySchema,
        response: { 200: CompatMapStatusSchema, ...E(400, 401, 403, 404) },
      },
    },
    (req) => retireMap(ctx, req, req.params.kind, req.body),
  );

  /* ------------------------------ support desk ------------------------------ */
  app.get(
    '/v1/ops/orders',
    {
      schema: {
        ...t('desk', 'Search orders'),
        querystring: OpsOrderQuerySchema,
        response: { 200: OpsOrderPageSchema, ...E(400, 401, 403) },
      },
    },
    (req) => listOrders(ctx, req, req.query),
  );
  app.get(
    '/v1/ops/orders/:id',
    {
      schema: {
        ...t('desk', 'An order in full. Reading it is audited.'),
        params: OpsIdParamsSchema,
        response: { 200: OpsOrderDetailSchema, ...E(401, 403, 404) },
      },
    },
    (req) => orderDetail(ctx, req, req.params.id),
  );
  app.post(
    '/v1/ops/orders/:id/notes',
    {
      schema: {
        ...t('desk', 'Add an internal note (append-only)'),
        params: OpsIdParamsSchema,
        body: OrderNoteBodySchema,
        response: { 201: OrderNoteSchema, ...E(400, 401, 403, 404) },
      },
    },
    async (req, reply) =>
      reply.code(201).send(await addOrderNote(ctx, req, req.params.id, req.body)),
  );
  app.get(
    '/v1/ops/customers/:id',
    {
      schema: {
        ...t('desk', 'A customer, masked. Reading it is audited.'),
        params: OpsIdParamsSchema,
        response: { 200: OpsCustomerSchema, ...E(401, 403, 404) },
      },
    },
    (req) => customerSummary(ctx, req, req.params.id),
  );
  app.get(
    '/v1/ops/viewings',
    {
      schema: {
        ...t('desk', 'Viewings'),
        querystring: OpsViewingQuerySchema,
        response: { 200: OpsViewingPageSchema, ...E(400, 401, 403) },
      },
    },
    (req) => listViewings(ctx, req, req.query),
  );
  app.get(
    '/v1/ops/viewings/:id',
    {
      schema: {
        ...t('desk', 'A viewing'),
        params: OpsIdParamsSchema,
        response: { 200: OpsViewingDetailSchema, ...E(401, 403, 404) },
      },
    },
    (req) => viewingDetail(ctx, req, req.params.id),
  );

  /* ------------------------------ staff ------------------------------ */
  app.get(
    '/v1/ops/staff',
    {
      schema: {
        ...t('staff', 'Operations staff'),
        response: { 200: OpsStaffListSchema, ...E(401, 403) },
      },
    },
    (req) => listStaff(ctx, req),
  );
  app.post(
    '/v1/ops/staff',
    {
      schema: {
        ...t('staff', 'Invite an operations user'),
        body: InviteStaffBodySchema,
        response: { 201: InviteStaffResultSchema, ...E(400, 401, 403, 409) },
      },
    },
    async (req, reply) => reply.code(201).send(await inviteStaff(ctx, req, req.body)),
  );
  app.patch(
    '/v1/ops/staff/:id',
    {
      schema: {
        ...t('staff', 'Change role or disable. The last administrator cannot be removed.'),
        params: OpsIdParamsSchema,
        body: PatchStaffBodySchema,
        response: { 200: OpsStaffSchema, ...E(400, 401, 403, 404, 409) },
      },
    },
    (req) => patchStaff(ctx, req, req.params.id, req.body),
  );
  app.post(
    '/v1/ops/staff/:id/mfa-reset',
    {
      schema: {
        ...t('staff', 'Reset an ops user’s two-factor and end their sessions'),
        params: OpsIdParamsSchema,
        body: MfaResetBodySchema,
        response: { 200: MfaResetResultSchema, ...E(400, 401, 403, 409) },
      },
    },
    (req) => resetMfa(ctx, req, 'ops', req.params.id, req.body),
  );
  app.post(
    '/v1/ops/seller-users/:id/mfa-reset',
    {
      schema: {
        ...t('staff', 'Reset a seller user’s two-factor and end their sessions'),
        params: OpsIdParamsSchema,
        body: MfaResetBodySchema,
        response: { 200: MfaResetResultSchema, ...E(400, 401, 403, 409) },
      },
    },
    (req) => resetMfa(ctx, req, 'seller', req.params.id, req.body),
  );

  /* ------------------------------ audit, flags, overview ------------------------------ */
  app.get(
    '/v1/ops/audit',
    {
      schema: {
        ...t('platform', 'Audit trail'),
        querystring: OpsAuditQuerySchema,
        response: { 200: OpsAuditPageSchema, ...E(400, 401, 403) },
      },
    },
    (req) => auditEvents(ctx, req, req.query),
  );
  app.get(
    '/v1/ops/feature-flags',
    {
      schema: {
        ...t('platform', 'Feature flags'),
        response: { 200: FeatureFlagListSchema, ...E(401, 403) },
      },
    },
    (req) => listFlags(ctx, req),
  );
  app.get(
    '/v1/ops/feature-flags/:key',
    {
      schema: {
        ...t('platform', 'A feature flag'),
        params: FlagKeyParamsSchema,
        response: { 200: FeatureFlagSchema, ...E(401, 403, 404) },
      },
    },
    (req) => getFlag(ctx, req, req.params.key),
  );
  app.put(
    '/v1/ops/feature-flags/:key',
    {
      schema: {
        ...t('platform', 'Create or change a feature flag'),
        params: FlagKeyParamsSchema,
        body: PutFeatureFlagBodySchema,
        response: { 200: FeatureFlagSchema, ...E(400, 401, 403) },
      },
    },
    (req) => putFlag(ctx, req, req.params.key, req.body),
  );
  app.get(
    '/v1/ops/overview',
    {
      schema: {
        ...t('platform', 'Queue sizes'),
        response: { 200: OverviewSchema, ...E(401, 403) },
      },
    },
    (req) => overview(ctx, req),
  );
};
