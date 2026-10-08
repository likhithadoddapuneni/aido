import { z } from 'zod';
import { FilsSchema, InstantSchema, UuidSchema } from './common.ts';
import { AVAILABILITY, ColourSchema, StyleSchema, VIEWING_STATUS } from './catalogue.ts';

const EMIRATES = [
  'Abu Dhabi',
  'Dubai',
  'Sharjah',
  'Ajman',
  'Umm Al Quwain',
  'Ras Al Khaimah',
  'Fujairah',
] as const;
const Text = (max: number) => z.string().trim().min(1).max(max);
const IdParam = z.object({ id: UuidSchema });
export const SellerIdParamsSchema = IdParam;

/* ---------------- Profile and showrooms ---------------- */

/** What a seller sees of their own record. Commission, status and legal identity are read-only facts. */
export const SellerProfileSchema = z.object({
  code: z.string(),
  tradeName: z.string(),
  legalName: z.string(),
  status: z.string(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  afterSalesTerms: z.string().nullable(),
});

/** `.strict()`: a request that names commission, status or any other ops-only field is refused, not ignored. */
export const UpdateProfileBodySchema = z
  .object({
    tradeName: Text(120).optional(),
    contactEmail: z.email().max(200).nullable().optional(),
    contactPhone: z
      .string()
      .regex(/^\+[1-9][0-9]{7,14}$/)
      .nullable()
      .optional(),
    afterSalesTerms: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update.');

export const OpeningHoursSchema = z.partialRecord(
  z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
  z
    .array(
      z.object({
        open: z.string().regex(/^\d{2}:\d{2}$/),
        close: z.string().regex(/^\d{2}:\d{2}$/),
      }),
    )
    .max(3),
);

export const LocationSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  address: z.string(),
  emirate: z.enum(EMIRATES),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  openingHours: OpeningHoursSchema,
  status: z.enum(['Active', 'Inactive']),
});
export const LocationsSchema = z.object({ locations: z.array(LocationSchema) });

const geo = { lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) };
export const CreateLocationBodySchema = z
  .object({
    name: Text(120),
    address: Text(300),
    emirate: z.enum(EMIRATES),
    ...geo,
    openingHours: OpeningHoursSchema.default({}),
  })
  .partial({ lat: true, lng: true })
  .strict()
  .refine(
    (b) => (b.lat === undefined) === (b.lng === undefined),
    'Give both lat and lng, or neither.',
  );
export const UpdateLocationBodySchema = z
  .object({
    name: Text(120),
    address: Text(300),
    emirate: z.enum(EMIRATES),
    lat: geo.lat.nullable(),
    lng: geo.lng.nullable(),
    openingHours: OpeningHoursSchema,
    status: z.enum(['Active', 'Inactive']),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update.');

/* ---------------- Products a seller submits ---------------- */

const Dim = z.number();
const Attrs = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

/** The product facts a seller states. Validation of values lives in the domain (`validateProductData`). */
export const ProductDataSchema = z
  .object({
    name: z.string().max(200),
    type: z.string().max(60),
    widthCm: Dim,
    depthCm: Dim,
    heightCm: Dim,
    primaryColour: z.string().max(30),
    secondaryColour: z.string().max(30).nullable(),
    specificColour: z.string().max(80).nullable(),
    primaryStyle: z.string().max(30),
    secondaryStyle: z.string().max(30).nullable(),
    material: z.string().max(30),
    attributes: Attrs,
  })
  .partial()
  .strict();

export const SellerProductSchema = z.object({
  id: z.string().regex(/^AID-\d{8}$/),
  name: z.string(),
  type: z.string(),
  dataStatus: z.enum(['Incomplete', 'Ready for Review', 'Verified']),
  /** What is missing before the product can be sent for review. */
  missing: z.array(z.string()),
  widthCm: z.number().nullable(),
  depthCm: z.number().nullable(),
  heightCm: z.number().nullable(),
  primaryColour: ColourSchema.nullable(),
  primaryStyle: StyleSchema.nullable(),
  material: z.string().nullable(),
  attributes: Attrs,
  media: z.array(z.object({ id: UuidSchema, storageKey: z.string(), position: z.number().int() })),
});
export const SellerProductsSchema = z.object({ products: z.array(SellerProductSchema) });
export const SellerProductParamsSchema = z.object({ id: z.string().regex(/^AID-\d{8}$/) });

export const UpdateProductBodySchema = ProductDataSchema.refine(
  (b) => Object.keys(b).length > 0,
  'Nothing to update.',
);

export const MediaUploadBodySchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z.number().int().min(1).max(10_000_000),
});
export const MediaUploadSchema = z.object({
  storageKey: z.string(),
  uploadUrl: z.string().url(),
  expiresAt: InstantSchema,
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
});
export const MediaConfirmBodySchema = z.object({
  storageKey: z.string().max(300),
  position: z.number().int().min(0).max(20),
  altText: z.string().max(200).nullable().default(null),
  widthPx: z.number().int().positive().max(20000).nullable().default(null),
  heightPx: z.number().int().positive().max(20000).nullable().default(null),
});

/* ---------------- Offers ---------------- */

const Sku = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[A-Za-z0-9._\-/]+$/, 'SKU may contain letters, digits and . _ - /');
const ViewingStatus = z.enum(VIEWING_STATUS);
const Availability = z.enum(AVAILABILITY);

export const OfferSchema = z.object({
  id: z.string().regex(/^AIO-\d{8}$/),
  productId: z.string(),
  productName: z.string(),
  productType: z.string(),
  productDataStatus: z.enum(['Incomplete', 'Ready for Review', 'Verified']),
  sku: z.string(),
  sellingPrice: FilsSchema,
  originalPrice: FilsSchema.nullable(),
  stockQty: z.number().int(),
  /** Held by live checkouts; stock cannot be set below this. */
  reservedQty: z.number().int(),
  availability: z.enum(AVAILABILITY),
  deliveryDays: z.number().int(),
  viewingStatus: ViewingStatus,
  viewingConfirmedAt: InstantSchema.nullable(),
  locationId: UuidSchema,
  status: z.enum(['Active', 'Inactive']),
  /** Send this back as `expectedVersion` when editing; a stale version is refused. */
  version: z.number().int(),
  /** Whether buyers can currently be offered this (Verified product, Active, in stock). */
  live: z.boolean(),
  updatedAt: InstantSchema,
});
export type Offer = z.infer<typeof OfferSchema>;

const OfferFields = {
  sku: Sku,
  sellingPrice: FilsSchema.positive(),
  originalPrice: FilsSchema.positive().nullable().default(null),
  stockQty: z.number().int().min(0).max(100_000),
  deliveryDays: z.number().int().min(0).max(120),
  viewingStatus: ViewingStatus.default('Not Viewable'),
  locationId: UuidSchema,
};

export const CreateOfferBodySchema = z
  .object({
    productId: z
      .string()
      .regex(/^AID-\d{8}$/)
      .optional(),
    newProduct: ProductDataSchema.optional(),
    ...OfferFields,
    availability: Availability.optional(),
  })
  .strict()
  .refine(
    (b) => (b.productId === undefined) !== (b.newProduct === undefined),
    'Give either productId or newProduct.',
  );

/** Role limits (staff: stock and viewing only) are enforced by the service; the schema fixes the columns. */
export const UpdateOfferBodySchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    sku: OfferFields.sku,
    sellingPrice: OfferFields.sellingPrice,
    originalPrice: FilsSchema.positive().nullable(),
    stockQty: OfferFields.stockQty,
    availability: Availability,
    deliveryDays: OfferFields.deliveryDays,
    viewingStatus: ViewingStatus,
    /** Staff confirm the product is on display now; refreshes the viewing confirmation clock. */
    displayConfirmed: z.literal(true),
    locationId: OfferFields.locationId,
    status: z.enum(['Active', 'Inactive']),
  })
  .partial()
  .required({ expectedVersion: true })
  .strict()
  .refine((b) => Object.keys(b).length > 1, 'Nothing to update.');

export const OffersQuerySchema = z.object({
  status: z.enum(['Active', 'Inactive']).optional(),
  availability: Availability.optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
});
export const OffersPageSchema = z.object({
  items: z.array(OfferSchema),
  nextCursor: z.string().nullable(),
});
export const OfferParamsSchema = z.object({ id: z.string().regex(/^AIO-\d{8}$/) });

export const CreatedOfferSchema = z.object({ offer: OfferSchema, product: SellerProductSchema });

/* ---------------- Bulk import ---------------- */

export const CreateImportBodySchema = z
  .object({
    filename: z.string().trim().min(1).max(200).default('import.csv'),
    csv: z.string().min(1),
  })
  .strict();

export const ImportRowSchema = z.object({
  row: z.number().int(),
  status: z.enum(['Valid', 'Invalid', 'Imported']),
  sku: z.string().nullable(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })),
});
export const ImportJobSchema = z.object({
  id: UuidSchema,
  state: z.enum(['Uploaded', 'Validating', 'Validated', 'Imported', 'Failed']),
  filename: z.string(),
  totalRows: z.number().int().nullable(),
  errorRows: z.number().int().nullable(),
  createdCount: z.number().int().nullable(),
  updatedCount: z.number().int().nullable(),
  skippedCount: z.number().int().nullable(),
  createdAt: InstantSchema,
});
export const ImportDetailSchema = ImportJobSchema.extend({ rows: z.array(ImportRowSchema) });
export const ImportsSchema = z.object({ imports: z.array(ImportJobSchema) });

/* ---------------- Team ---------------- */

export const TeamMemberSchema = z.object({
  id: UuidSchema,
  email: z.string(),
  fullName: z.string(),
  role: z.enum(['seller_owner', 'seller_manager', 'seller_staff']),
  status: z.enum(['Invited', 'Active', 'Disabled']),
  locationId: UuidSchema.nullable(),
});
export const TeamSchema = z.object({ members: z.array(TeamMemberSchema) });
export const InviteBodySchema = z
  .object({
    email: z.email().max(200),
    fullName: Text(120),
    role: z.enum(['seller_owner', 'seller_manager', 'seller_staff']),
    locationId: UuidSchema.nullable().default(null),
  })
  .strict();
export const UpdateMemberBodySchema = z
  .object({
    role: z.enum(['seller_owner', 'seller_manager', 'seller_staff']),
    locationId: UuidSchema.nullable(),
    status: z.enum(['Active', 'Disabled']),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update.');

/* ---------------- Performance ---------------- */

export const PerformanceQuerySchema = z.object({ period: z.enum(['30d', '90d']).default('30d') });
const Rate = z.number().min(0).max(1).nullable();
export const PerformanceSchema = z.object({
  period: z.enum(['30d', '90d']),
  from: InstantSchema,
  to: InstantSchema,
  confirmation: z.object({
    purchase: z.object({ requests: z.number().int(), confirmed: z.number().int(), rate: Rate }),
    viewing: z.object({ requests: z.number().int(), confirmed: z.number().int(), rate: Rate }),
    responseSeconds: z.object({ median: z.number().nullable(), p90: z.number().nullable() }),
  }),
  fulfilment: z.object({ dueLines: z.number().int(), onTime: z.number().int(), onTimeRate: Rate }),
  issues: z.object({
    lines: z.number().int(),
    issues: z.number().int(),
    issueRate: z.number().min(0).nullable(),
  }),
});
