import {
  AddressInputSchema,
  AddressSchema,
  ConsentGrantSchema,
  ConsentPurposeSchema,
  ConsentSchema,
  CustomerSchema,
  DataExportSchema,
  DeviceRegistrationSchema,
  DeviceRemovalSchema,
  ErasureResponseSchema,
  MeSchema,
  PatchMeSchema,
  UuidSchema,
  errorResponses,
} from '@aidooi/contracts';
import { z } from 'zod';
import { requireActor } from '../../http/actor.ts';
import type { ModuleRoutes } from '../registry.ts';
import {
  createAddress,
  deleteAddress,
  eraseAccount,
  exportData,
  getMe,
  grantConsent,
  listAddresses,
  patchMe,
  registerDevice,
  removeDevice,
  updateAddress,
  withdrawConsent,
  type AddressInput,
} from './me.ts';

const tags = ['me'];
const security = [{ bearer: [] }];
const auth = { tags, security };
const NoContent = { 204: z.null() } as const;

/** The signed-in principal's own data. Nothing here takes a user id: you can only ever see yourself. */
export const meRoutes: ModuleRoutes = async (app, ctx) => {
  app.get(
    '/v1/me',
    { schema: { ...auth, response: { 200: MeSchema, 401: errorResponses[401] } } },
    async (req) => getMe(ctx, requireActor(req)),
  );

  app.patch(
    '/v1/me',
    {
      schema: {
        ...auth,
        body: PatchMeSchema,
        response: {
          200: CustomerSchema,
          401: errorResponses[401],
          403: errorResponses[403],
          409: errorResponses[409],
        },
      },
    },
    async (req) => {
      const { fullName, locale, email } = req.body;
      return patchMe(ctx, req, {
        ...(fullName !== undefined ? { fullName } : {}),
        ...(locale !== undefined ? { locale } : {}),
        ...(email !== undefined ? { email } : {}),
      });
    },
  );

  app.put(
    '/v1/me/devices',
    {
      schema: {
        ...auth,
        body: DeviceRegistrationSchema,
        response: { ...NoContent, 401: errorResponses[401], 403: errorResponses[403] },
      },
    },
    async (req, reply) => {
      await registerDevice(ctx, requireActor(req), req.body);
      return reply.code(204).send(null);
    },
  );

  app.delete(
    '/v1/me/devices',
    {
      schema: {
        ...auth,
        body: DeviceRemovalSchema,
        response: { ...NoContent, 401: errorResponses[401], 403: errorResponses[403] },
      },
    },
    async (req, reply) => {
      await removeDevice(ctx, requireActor(req), req.body.pushToken);
      return reply.code(204).send(null);
    },
  );

  app.put(
    '/v1/me/consent/:purpose',
    {
      schema: {
        ...auth,
        params: z.object({ purpose: ConsentPurposeSchema }),
        body: ConsentGrantSchema,
        response: { 200: ConsentSchema, 401: errorResponses[401], 403: errorResponses[403] },
      },
    },
    async (req) => grantConsent(ctx, req, req.params.purpose, req.body.policyVersion),
  );

  app.delete(
    '/v1/me/consent/:purpose',
    {
      schema: {
        ...auth,
        params: z.object({ purpose: ConsentPurposeSchema }),
        response: {
          ...NoContent,
          401: errorResponses[401],
          403: errorResponses[403],
          422: errorResponses[422],
        },
      },
    },
    async (req, reply) => {
      await withdrawConsent(ctx, req, req.params.purpose);
      return reply.code(204).send(null);
    },
  );

  app.get(
    '/v1/me/addresses',
    {
      schema: {
        ...auth,
        response: {
          200: z.array(AddressSchema),
          401: errorResponses[401],
          403: errorResponses[403],
        },
      },
    },
    async (req) => listAddresses(ctx, req),
  );

  app.post(
    '/v1/me/addresses',
    {
      schema: {
        ...auth,
        body: AddressInputSchema,
        response: {
          201: AddressSchema,
          401: errorResponses[401],
          403: errorResponses[403],
          422: errorResponses[422],
        },
      },
    },
    async (req, reply) =>
      reply.code(201).send(await createAddress(ctx, req, req.body as AddressInput)),
  );

  app.put(
    '/v1/me/addresses/:id',
    {
      schema: {
        ...auth,
        params: z.object({ id: UuidSchema }),
        body: AddressInputSchema,
        response: {
          200: AddressSchema,
          401: errorResponses[401],
          404: errorResponses[404],
          422: errorResponses[422],
        },
      },
    },
    async (req) => updateAddress(ctx, req, req.params.id, req.body as AddressInput),
  );

  app.delete(
    '/v1/me/addresses/:id',
    {
      schema: {
        ...auth,
        params: z.object({ id: UuidSchema }),
        response: { ...NoContent, 401: errorResponses[401], 404: errorResponses[404] },
      },
    },
    async (req, reply) => {
      await deleteAddress(ctx, req, req.params.id);
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/v1/me/erasure',
    {
      schema: {
        ...auth,
        response: {
          200: ErasureResponseSchema,
          401: errorResponses[401],
          403: errorResponses[403],
        },
      },
    },
    async (req) => {
      await eraseAccount(ctx, req);
      return { status: 'erased' as const };
    },
  );

  app.get(
    '/v1/me/export',
    {
      schema: {
        ...auth,
        response: { 200: DataExportSchema, 401: errorResponses[401], 403: errorResponses[403] },
      },
    },
    async (req) => exportData(ctx, req),
  );
};
