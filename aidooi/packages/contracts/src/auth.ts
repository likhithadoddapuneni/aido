import { z } from 'zod';
import { InstantSchema, UuidSchema } from './common.ts';

const E164 = z
  .string()
  .regex(/^\+[1-9][0-9]{7,14}$/, 'Use international format, e.g. +971501234567');

/* ---------------- Buyer sign-in ---------------- */

export const GuestSessionResponseSchema = z.object({
  guestToken: z.string().describe('Send as `Authorization: Guest <token>`. Shown once.'),
  expiresAt: InstantSchema,
});

export const OtpRequestSchema = z.object({
  phone: E164,
  channel: z.enum(['sms', 'whatsapp']).default('sms'),
});
export const OtpRequestResponseSchema = z.object({ status: z.literal('sent') });

export const OtpVerifySchema = z.object({
  phone: E164,
  code: z.string().regex(/^\d{6}$/),
  /** Upgrades this guest session in place; the project continues where it was. */
  guestToken: z.string().min(20).max(128).optional(),
  /** Required the first time a phone signs in: the version of the terms being accepted. */
  policyVersion: z.string().min(1).max(40).optional(),
});

export const OAuthProviderSchema = z.enum(['apple', 'google']);
export const OAuthSignInSchema = z.object({
  idToken: z.string().min(20).max(8192),
  guestToken: z.string().min(20).max(128).optional(),
  policyVersion: z.string().min(1).max(40).optional(),
});

export const TokenPairSchema = z.object({
  tokenType: z.literal('Bearer'),
  accessToken: z.string(),
  expiresIn: z.number().int().describe('Access token lifetime in seconds'),
  refreshToken: z.string().describe('Single use; every refresh returns a new one'),
});

export const BuyerSessionSchema = TokenPairSchema.extend({
  customer: z.object({ id: UuidSchema, isNew: z.boolean() }),
});

export const RefreshRequestSchema = z.object({ refreshToken: z.string().min(20).max(256) });

/* ---------------- Staff (sellers and ops) ---------------- */

export const StaffAcceptInviteSchema = z.object({
  token: z.string().min(20).max(128),
  password: z.string().min(12).max(256),
});
export const StaffAcceptInviteResponseSchema = z.object({ email: z.email() });

const StaffCredentials = z.object({
  email: z.email(),
  password: z.string().min(1).max(256),
});
export const StaffMfaEnrollSchema = StaffCredentials;
export const StaffMfaEnrollResponseSchema = z.object({
  seed: z.string().describe('Base32 TOTP seed, shown once'),
  otpauthUri: z.string(),
});
export const StaffMfaVerifySchema = StaffCredentials.extend({
  totpCode: z.string().regex(/^\d{6}$/),
});
export const StaffLoginSchema = StaffMfaVerifySchema;

export const StaffSessionSchema = TokenPairSchema.extend({
  staff: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('seller'),
      id: UuidSchema,
      role: z.string(),
      partnerId: UuidSchema,
    }),
    z.object({ kind: z.literal('ops'), id: UuidSchema, role: z.string() }),
  ]),
});

/* ---------------- Me ---------------- */

export const CustomerSchema = z.object({
  id: UuidSchema,
  phone: z.string().nullable(),
  email: z.string().nullable(),
  fullName: z.string().nullable(),
  locale: z.enum(['en', 'ar']),
  createdAt: InstantSchema,
});
export const MeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('buyer'),
    customer: CustomerSchema.nullable(),
    guestSessionId: UuidSchema.nullable(),
  }),
  z.object({
    kind: z.literal('seller'),
    id: UuidSchema,
    email: z.string(),
    fullName: z.string(),
    role: z.string(),
    partnerId: UuidSchema,
    locationId: UuidSchema.nullable(),
  }),
  z.object({
    kind: z.literal('ops'),
    id: UuidSchema,
    email: z.string(),
    fullName: z.string(),
    role: z.string(),
  }),
]);

export const PatchMeSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120),
    locale: z.enum(['en', 'ar']),
    email: z.email().max(254),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const DeviceRegistrationSchema = z.object({
  platform: z.enum(['ios', 'android', 'web']),
  pushToken: z.string().min(8).max(4096),
  appVersion: z.string().max(32).optional(),
});
export const DeviceRemovalSchema = z.object({ pushToken: z.string().min(8).max(4096) });

export const ConsentPurposeSchema = z.enum(['terms', 'marketing', 'analytics']);
export const ConsentGrantSchema = z.object({ policyVersion: z.string().min(1).max(40) });
export const ConsentSchema = z.object({
  purpose: ConsentPurposeSchema,
  policyVersion: z.string(),
  grantedAt: InstantSchema,
});

export const ADDRESS_EMIRATES = [
  'Abu Dhabi',
  'Dubai',
  'Sharjah',
  'Ajman',
  'Umm Al Quwain',
  'Ras Al Khaimah',
  'Fujairah',
] as const;
export const AddressInputSchema = z.object({
  label: z.string().max(40).nullable().optional(),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().max(200).nullable().optional(),
  area: z.string().max(100).nullable().optional(),
  emirate: z.enum(ADDRESS_EMIRATES),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  isDefault: z.boolean().optional(),
});
export const AddressSchema = AddressInputSchema.extend({ id: UuidSchema, isDefault: z.boolean() });

export const ErasureResponseSchema = z.object({ status: z.literal('erased') });
export const DataExportSchema = z.object({
  exportedAt: InstantSchema,
  customer: CustomerSchema,
  addresses: z.array(AddressSchema),
  consents: z.array(ConsentSchema.extend({ withdrawnAt: InstantSchema.nullable() })),
  devices: z.array(
    z.object({
      platform: z.string(),
      appVersion: z.string().nullable(),
      lastSeenAt: InstantSchema,
    }),
  ),
  projects: z.array(
    z.object({ id: UuidSchema, pathId: z.string(), state: z.string(), spec: z.unknown() }),
  ),
  orders: z.array(
    z.object({
      id: UuidSchema,
      grossFils: z.number().int(),
      paidFils: z.number().int(),
      placedAt: InstantSchema,
    }),
  ),
  viewings: z.array(z.object({ id: UuidSchema, state: z.string(), createdAt: InstantSchema })),
});
