import { z } from 'zod';
import {
  CreateImportBodySchema,
  CreateLocationBodySchema,
  CreateOfferBodySchema,
  CreatedOfferSchema,
  ImportDetailSchema,
  ImportJobSchema,
  ImportsSchema,
  InviteBodySchema,
  LocationSchema,
  LocationsSchema,
  MediaConfirmBodySchema,
  MediaUploadBodySchema,
  MediaUploadSchema,
  OfferParamsSchema,
  OfferSchema,
  OffersPageSchema,
  OffersQuerySchema,
  PerformanceQuerySchema,
  PerformanceSchema,
  SellerIdParamsSchema,
  SellerProductParamsSchema,
  SellerProductSchema,
  SellerProductsSchema,
  SellerProfileSchema,
  TeamMemberSchema,
  TeamSchema,
  UpdateLocationBodySchema,
  UpdateMemberBodySchema,
  UpdateOfferBodySchema,
  UpdateProductBodySchema,
  UpdateProfileBodySchema,
  errorsFor,
} from '@aidooi/contracts';
import { requireSeller } from '../../http/actor.ts';
import type { ModuleRoutes } from '../registry.ts';
import { errorReportCsv, commitImport, createImport, getImport, listImports } from './imports.ts';
import { templateCsv } from './import-csv.ts';
import {
  createLocation,
  getProfile,
  listLocations,
  updateLocation,
  updateProfile,
} from './profile.ts';
import { createOffer, getOffer, listOffers, updateOffer } from './offers.ts';
import { performance } from './performance.ts';
import { confirmUpload, listProducts, requestUpload, updateProduct } from './products.ts';
import { invite, listTeam, updateMember } from './team.ts';

const tags = ['seller'];
const authz = errorsFor(401, 403);

export const sellerRoutes: ModuleRoutes = async (app, ctx) => {
  /* ---- profile and showrooms ---- */
  app.get(
    '/v1/seller/profile',
    {
      schema: {
        tags,
        summary: 'My store profile',
        response: { 200: SellerProfileSchema, ...authz },
      },
    },
    (req) => getProfile(ctx, req),
  );
  app.patch(
    '/v1/seller/profile',
    {
      schema: {
        tags,
        summary:
          'Update trade name, contact details and after-sales terms. Commission, status and legal identity are ops-only.',
        body: UpdateProfileBodySchema,
        response: { 200: SellerProfileSchema, ...errorsFor(400, 401, 403) },
      },
    },
    async (req) => {
      return updateProfile(ctx, req, req.body);
    },
  );

  app.get(
    '/v1/seller/locations',
    { schema: { tags, response: { 200: LocationsSchema, ...authz } } },
    async (req) => ({ locations: await listLocations(ctx, req) }),
  );
  app.post(
    '/v1/seller/locations',
    {
      schema: {
        tags,
        body: CreateLocationBodySchema,
        response: { 201: LocationSchema, ...errorsFor(400, 401, 403) },
      },
    },
    async (req, reply) => reply.code(201).send(await createLocation(ctx, req, req.body)),
  );
  app.patch(
    '/v1/seller/locations/:id',
    {
      schema: {
        tags,
        summary:
          'Edit or close a showroom. A showroom with live offers or booked viewings cannot be closed.',
        params: SellerIdParamsSchema,
        body: UpdateLocationBodySchema,
        response: { 200: LocationSchema, ...errorsFor(400, 401, 403, 404, 409) },
      },
    },
    (req) => updateLocation(ctx, req, req.params.id, req.body),
  );

  /* ---- offers ---- */
  app.get(
    '/v1/seller/offers',
    {
      schema: {
        tags,
        querystring: OffersQuerySchema,
        response: { 200: OffersPageSchema, ...errorsFor(400, 401, 403) },
      },
    },
    (req) => listOffers(ctx, req, req.query),
  );
  app.get(
    '/v1/seller/offers/:id',
    {
      schema: {
        tags,
        params: OfferParamsSchema,
        response: { 200: OfferSchema, ...errorsFor(401, 403, 404) },
      },
    },
    (req) => getOffer(ctx, req, req.params.id),
  );
  app.post(
    '/v1/seller/offers',
    {
      schema: {
        tags,
        summary:
          'List an existing Verified product, or submit a new one for review together with its first offer.',
        body: CreateOfferBodySchema,
        response: { 201: CreatedOfferSchema, ...errorsFor(400, 401, 403, 404, 409, 422) },
      },
    },
    async (req, reply) => reply.code(201).send(await createOffer(ctx, req, req.body)),
  );
  app.patch(
    '/v1/seller/offers/:id',
    {
      schema: {
        tags,
        summary:
          'Change price, stock, delivery, display or status. Send the `version` you read; a stale version is refused. Staff may change stock and display only.',
        params: OfferParamsSchema,
        body: UpdateOfferBodySchema,
        response: { 200: OfferSchema, ...errorsFor(400, 401, 403, 404, 409, 422) },
      },
    },
    (req) => updateOffer(ctx, req, req.params.id, req.body),
  );

  /* ---- products a seller submits ---- */
  app.get(
    '/v1/seller/products',
    {
      schema: {
        tags,
        summary: 'Products my store has submitted',
        response: { 200: SellerProductsSchema, ...authz },
      },
    },
    async (req) => ({ products: await listProducts(ctx, req) }),
  );
  app.patch(
    '/v1/seller/products/:id',
    {
      schema: {
        tags,
        summary: 'Correct a submitted product. Editing a verified product returns it to review.',
        params: SellerProductParamsSchema,
        body: UpdateProductBodySchema,
        response: { 200: SellerProductSchema, ...errorsFor(400, 401, 403, 404, 422) },
      },
    },
    (req) => updateProduct(ctx, req, req.params.id, req.body),
  );
  app.post(
    '/v1/seller/products/:id/media',
    {
      schema: {
        tags,
        summary: 'Get a short-lived signed URL to upload one photograph directly to storage.',
        params: SellerProductParamsSchema,
        body: MediaUploadBodySchema,
        response: { 200: MediaUploadSchema, ...errorsFor(400, 401, 403, 404, 409, 503) },
      },
    },
    (req) => requestUpload(ctx, req, req.params.id, req.body),
  );
  app.post(
    '/v1/seller/products/:id/media/confirm',
    {
      schema: {
        tags,
        summary: 'Record an uploaded photograph once it has arrived in storage.',
        params: SellerProductParamsSchema,
        body: MediaConfirmBodySchema,
        response: { 200: SellerProductSchema, ...errorsFor(400, 401, 403, 404, 409, 422) },
      },
    },
    (req) => confirmUpload(ctx, req, req.params.id, req.body),
  );

  /* ---- bulk import ---- */
  app.get(
    '/v1/seller/imports/template.csv',
    {
      schema: {
        tags,
        summary: 'The import template (opens in Excel)',
        response: { 200: z.string(), ...authz },
      },
    },
    async (req, reply) => {
      requireSeller(req);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename="aidooi-import-template.csv"')
        .send(templateCsv());
    },
  );
  app.get(
    '/v1/seller/imports',
    { schema: { tags, response: { 200: ImportsSchema, ...authz } } },
    async (req) => ({ imports: await listImports(ctx, req) }),
  );
  app.post(
    '/v1/seller/imports',
    {
      bodyLimit: 8 * 1024 * 1024,
      schema: {
        tags,
        summary: 'Upload a CSV and validate it row by row. Nothing is imported until you commit.',
        body: CreateImportBodySchema,
        response: { 201: ImportJobSchema, ...errorsFor(400, 401, 403, 422) },
      },
    },
    async (req, reply) => reply.code(201).send(await createImport(ctx, req, req.body)),
  );
  app.get(
    '/v1/seller/imports/:id',
    {
      schema: {
        tags,
        params: SellerIdParamsSchema,
        response: { 200: ImportDetailSchema, ...errorsFor(401, 403, 404) },
      },
    },
    (req) => getImport(ctx, req, req.params.id),
  );
  app.get(
    '/v1/seller/imports/:id/errors.csv',
    {
      schema: {
        tags,
        summary: 'Row-level error report, safe to open in a spreadsheet',
        params: SellerIdParamsSchema,
        response: { 200: z.string(), ...errorsFor(401, 403, 404) },
      },
    },
    async (req, reply) =>
      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .send(await errorReportCsv(ctx, req, req.params.id)),
  );
  app.post(
    '/v1/seller/imports/:id/commit',
    {
      schema: {
        tags,
        summary:
          'Apply the valid rows. Re-committing a finished import changes nothing; a failed one resumes.',
        params: SellerIdParamsSchema,
        response: { 200: ImportJobSchema, ...errorsFor(401, 403, 404, 409) },
      },
    },
    (req) => commitImport(ctx, req, req.params.id),
  );

  /* ---- team ---- */
  app.get(
    '/v1/seller/team',
    { schema: { tags, response: { 200: TeamSchema, ...authz } } },
    async (req) => ({ members: await listTeam(ctx, req) }),
  );
  app.post(
    '/v1/seller/team/invitations',
    {
      schema: {
        tags,
        summary:
          'Invite a colleague. The invitation is delivered to them directly, never returned here.',
        body: InviteBodySchema,
        response: { 201: TeamMemberSchema, ...errorsFor(400, 401, 403, 404, 409) },
      },
    },
    async (req, reply) => reply.code(201).send(await invite(ctx, req, req.body)),
  );
  app.patch(
    '/v1/seller/team/:id',
    {
      schema: {
        tags,
        summary:
          'Change a colleague’s role or showroom, or disable them (access ends immediately).',
        params: SellerIdParamsSchema,
        body: UpdateMemberBodySchema,
        response: { 200: TeamMemberSchema, ...errorsFor(400, 401, 403, 404, 409) },
      },
    },
    (req) => updateMember(ctx, req, req.params.id, req.body),
  );

  /* ---- performance ---- */
  app.get(
    '/v1/seller/performance',
    {
      schema: {
        tags,
        querystring: PerformanceQuerySchema,
        response: { 200: PerformanceSchema, ...errorsFor(400, 401, 403) },
      },
    },
    (req) => performance(ctx, req, req.query.period),
  );
};
