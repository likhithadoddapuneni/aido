-- Catalogue: AIP / AID / AIO records (AID-DATA-001…014), partners and compatibility maps.
-- Business IDs are the primary keys (AID-DATA-005): global sequences, never reused, never changed.

CREATE SEQUENCE catalogue.aip_seq;
CREATE SEQUENCE catalogue.aid_seq;
CREATE SEQUENCE catalogue.aio_seq;

CREATE FUNCTION catalogue.business_id(prefix text, n bigint) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT prefix || '-' || lpad(n::text, 8, '0') $$;

CREATE TABLE catalogue.brand (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  status     text NOT NULL DEFAULT 'Active',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_name_uq UNIQUE (name),
  CONSTRAINT brand_status_enum CHECK (status IN ('Active', 'Inactive'))
);

CREATE TABLE catalogue.parent_product (
  id         text PRIMARY KEY DEFAULT catalogue.business_id('AIP', nextval('catalogue.aip_seq')),
  model_name text NOT NULL,
  brand_id   uuid REFERENCES catalogue.brand (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parent_product_id_ck CHECK (id ~ '^AIP-[0-9]{8}$')
);

CREATE TABLE catalogue.product (
  id               text PRIMARY KEY DEFAULT catalogue.business_id('AID', nextval('catalogue.aid_seq')),
  parent_id        text NOT NULL REFERENCES catalogue.parent_product (id),
  name             text NOT NULL,
  name_i18n        jsonb NOT NULL DEFAULT '{}',
  main_category    text NOT NULL,
  category         text NOT NULL,
  product_type     text NOT NULL,
  width_cm         integer,
  depth_cm         integer,
  height_cm        integer,
  primary_colour   text,
  secondary_colour text,
  specific_colour  text,
  material_family  text,
  specific_material text,
  primary_style    text,
  secondary_style  text,
  attributes       jsonb NOT NULL DEFAULT '{}',
  data_status      text NOT NULL DEFAULT 'Incomplete',
  lifecycle        text NOT NULL DEFAULT 'Active',
  verified_by      uuid REFERENCES identity.ops_user (id),
  verified_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_id_ck CHECK (id ~ '^AID-[0-9]{8}$'),
  CONSTRAINT product_dims_ck CHECK (
    (width_cm IS NULL OR width_cm > 0) AND (depth_cm IS NULL OR depth_cm > 0)
    AND (height_cm IS NULL OR height_cm > 0)),
  CONSTRAINT product_primary_colour_enum CHECK (primary_colour IN
    ('white','beige','grey','black','brown','natural','green','blue','red','orange','yellow','pink','purple','gold','silver','brass','bronze','multicolour')),
  CONSTRAINT product_secondary_colour_enum CHECK (secondary_colour IN
    ('white','beige','grey','black','brown','natural','green','blue','red','orange','yellow','pink','purple','gold','silver','brass','bronze','multicolour')),
  CONSTRAINT product_primary_style_enum CHECK (primary_style IN
    ('modern','contemporary','mcm','scandinavian','minimalist','japandi','industrial','classic','traditional')),
  CONSTRAINT product_secondary_style_enum CHECK (secondary_style IN
    ('modern','contemporary','mcm','scandinavian','minimalist','japandi','industrial','classic','traditional')),
  CONSTRAINT product_material_family_enum CHECK (material_family IN
    ('Wood','Metal','Fabric','Leather','Glass','Stone','Rattan','Ceramic')),
  CONSTRAINT product_data_status_enum CHECK (data_status IN ('Incomplete', 'Ready for Review', 'Verified')),
  CONSTRAINT product_lifecycle_enum CHECK (lifecycle IN ('Active', 'Inactive')),
  CONSTRAINT product_attributes_ck CHECK (jsonb_typeof(attributes) = 'object'),
  -- AID-DATA-014: nothing reaches recommendation unless the fields fit scoring needs are present.
  CONSTRAINT product_verified_complete_ck CHECK (data_status <> 'Verified' OR (
    width_cm IS NOT NULL AND depth_cm IS NOT NULL AND height_cm IS NOT NULL
    AND primary_colour IS NOT NULL AND material_family IS NOT NULL AND primary_style IS NOT NULL
    AND verified_by IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX product_type_idx ON catalogue.product (product_type) WHERE data_status = 'Verified' AND lifecycle = 'Active';
CREATE INDEX product_parent_idx ON catalogue.product (parent_id);

CREATE TABLE catalogue.product_media (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  text NOT NULL REFERENCES catalogue.product (id),
  storage_key text NOT NULL,
  position    smallint NOT NULL DEFAULT 0,
  alt_text    text,
  width_px    integer,
  height_px   integer,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_media_position_uq UNIQUE (product_id, position)
);

CREATE TABLE catalogue.partner (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL,
  legal_name       text NOT NULL,
  trade_name       text NOT NULL,
  tax_registration_no text,
  status           text NOT NULL DEFAULT 'Requested',
  commission_rate  numeric(5, 4) NOT NULL,
  after_sales_terms text,
  contact_email    text,
  contact_phone    text,
  activated_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_code_uq UNIQUE (code),
  CONSTRAINT partner_code_ck CHECK (code ~ '^PRT-[0-9]{4,}$'),
  CONSTRAINT partner_status_enum CHECK (status IN
    ('Requested', 'Under Review', 'Approved/Agreement Pending', 'Active', 'Inactive')),
  CONSTRAINT partner_commission_ck CHECK (commission_rate BETWEEN 0 AND 1),
  CONSTRAINT partner_activated_ck CHECK (status <> 'Active' OR activated_at IS NOT NULL)
);
CREATE TRIGGER partner_touch BEFORE UPDATE ON catalogue.partner
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE catalogue.partner_location (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id   uuid NOT NULL REFERENCES catalogue.partner (id),
  name         text NOT NULL,
  address      text NOT NULL,
  emirate      text NOT NULL,
  lat          numeric(9, 6),
  lng          numeric(9, 6),
  opening_hours jsonb NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'Active',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_location_emirate_enum CHECK (emirate IN
    ('Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah')),
  CONSTRAINT partner_location_status_enum CHECK (status IN ('Active', 'Inactive')),
  CONSTRAINT partner_location_geo_ck CHECK ((lat IS NULL) = (lng IS NULL)),
  -- Lets child tables prove a location belongs to the partner they claim.
  CONSTRAINT partner_location_partner_uq UNIQUE (id, partner_id)
);
CREATE INDEX partner_location_partner_idx ON catalogue.partner_location (partner_id);
CREATE TRIGGER partner_location_touch BEFORE UPDATE ON catalogue.partner_location
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE catalogue.seller_offer (
  id                  text PRIMARY KEY DEFAULT catalogue.business_id('AIO', nextval('catalogue.aio_seq')),
  product_id          text NOT NULL REFERENCES catalogue.product (id),
  partner_id          uuid NOT NULL REFERENCES catalogue.partner (id),
  partner_location_id uuid NOT NULL,
  seller_sku          text NOT NULL,
  selling_price_fils  bigint NOT NULL,
  original_price_fils bigint,
  availability        text NOT NULL,
  stock_qty           integer NOT NULL,
  viewing_status      text NOT NULL DEFAULT 'Not Viewable',
  viewing_confirmed_at timestamptz,
  delivery_days       integer NOT NULL,
  commission_rate     numeric(5, 4) NOT NULL,
  offer_status        text NOT NULL DEFAULT 'Active',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seller_offer_id_ck CHECK (id ~ '^AIO-[0-9]{8}$'),
  CONSTRAINT seller_offer_location_fk FOREIGN KEY (partner_location_id, partner_id)
    REFERENCES catalogue.partner_location (id, partner_id),
  CONSTRAINT seller_offer_id_partner_uq UNIQUE (id, partner_id),
  CONSTRAINT seller_offer_sku_uq UNIQUE (partner_id, seller_sku),
  CONSTRAINT seller_offer_unique_listing_uq UNIQUE (product_id, partner_id, partner_location_id),
  CONSTRAINT seller_offer_price_ck CHECK (selling_price_fils > 0),
  -- Original price is display-only and never drives tier classification (AID-DATA-010).
  CONSTRAINT seller_offer_original_price_ck CHECK (original_price_fils IS NULL OR original_price_fils >= selling_price_fils),
  CONSTRAINT seller_offer_availability_enum CHECK (availability IN ('In Stock', 'Low Stock', 'Out of Stock')),
  CONSTRAINT seller_offer_stock_ck CHECK (stock_qty >= 0 AND (stock_qty > 0 OR availability = 'Out of Stock')),
  CONSTRAINT seller_offer_viewing_status_enum CHECK (viewing_status IN
    ('On Display', 'Viewable on Request', 'Not Viewable')),
  CONSTRAINT seller_offer_delivery_ck CHECK (delivery_days >= 0),
  CONSTRAINT seller_offer_commission_ck CHECK (commission_rate BETWEEN 0 AND 1),
  CONSTRAINT seller_offer_offer_status_enum CHECK (offer_status IN ('Active', 'Inactive'))
);
CREATE INDEX seller_offer_product_idx ON catalogue.seller_offer (product_id) WHERE offer_status = 'Active';
CREATE INDEX seller_offer_partner_idx ON catalogue.seller_offer (partner_id);

-- Business IDs: immutable and never deleted.
CREATE TRIGGER parent_product_id_immutable BEFORE UPDATE ON catalogue.parent_product
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_of('id');
CREATE TRIGGER parent_product_no_delete BEFORE DELETE ON catalogue.parent_product
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_delete();
CREATE TRIGGER product_id_immutable BEFORE UPDATE ON catalogue.product
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_of('id');
CREATE TRIGGER product_no_delete BEFORE DELETE ON catalogue.product
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_delete();
CREATE TRIGGER seller_offer_id_immutable BEFORE UPDATE ON catalogue.seller_offer
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_of('id', 'product_id', 'partner_id');
CREATE TRIGGER seller_offer_no_delete BEFORE DELETE ON catalogue.seller_offer
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_delete();
CREATE TRIGGER product_touch BEFORE UPDATE ON catalogue.product
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
CREATE TRIGGER seller_offer_touch BEFORE UPDATE ON catalogue.seller_offer
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- The eligibility gate (docs/03 §2). Recommendation reads candidates only through this view.
-- security_invoker so the caller's row-level-security context applies to the underlying tables.
CREATE VIEW catalogue.eligible_offer WITH (security_invoker = true) AS
SELECT o.id AS offer_id, o.product_id, o.partner_id, o.partner_location_id,
       o.selling_price_fils, o.availability, o.stock_qty, o.viewing_status, o.delivery_days,
       o.commission_rate, p.product_type, p.parent_id
FROM catalogue.seller_offer o
JOIN catalogue.product p ON p.id = o.product_id
JOIN catalogue.partner pt ON pt.id = o.partner_id
WHERE p.data_status = 'Verified' AND p.lifecycle = 'Active'
  AND o.offer_status = 'Active' AND o.availability <> 'Out of Stock' AND o.stock_qty > 0
  AND pt.status = 'Active';

-- Controlled style / colour / material compatibility maps (AID-LOG-009 §12). Versioned, approved
-- by a named person, and immutable once written; a change is a new version.
CREATE TABLE catalogue.compat_map_version (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL,
  version      text NOT NULL,
  content      jsonb NOT NULL,
  approved_by  uuid NOT NULL REFERENCES identity.ops_user (id),
  activated_at timestamptz,
  retired_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compat_map_version_kind_enum CHECK (kind IN ('style', 'colour', 'material')),
  CONSTRAINT compat_map_version_uq UNIQUE (kind, version),
  CONSTRAINT compat_map_version_lifecycle_ck CHECK (retired_at IS NULL OR activated_at IS NOT NULL)
);
CREATE UNIQUE INDEX compat_map_version_active_uq ON catalogue.compat_map_version (kind)
  WHERE activated_at IS NOT NULL AND retired_at IS NULL;
CREATE TRIGGER compat_map_version_content_immutable BEFORE UPDATE ON catalogue.compat_map_version
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_of('kind', 'version', 'content', 'approved_by');
CREATE TRIGGER compat_map_version_no_delete BEFORE DELETE ON catalogue.compat_map_version
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_delete();
