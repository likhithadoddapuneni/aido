-- Seller identities, session families and device tokens (all principals), and catalogue imports.
-- Created after catalogue.partner so identity can reference it.

CREATE TABLE identity.seller_user (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id          uuid NOT NULL REFERENCES catalogue.partner (id),
  partner_location_id uuid,
  email               text NOT NULL,
  phone_e164          text,
  full_name           text NOT NULL,
  role                text NOT NULL,
  status              text NOT NULL DEFAULT 'Invited',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seller_user_email_uq UNIQUE (email),
  CONSTRAINT seller_user_email_ck CHECK (email = lower(email)),
  CONSTRAINT seller_user_role_enum CHECK (role IN ('seller_owner', 'seller_manager', 'seller_staff')),
  CONSTRAINT seller_user_status_enum CHECK (status IN ('Invited', 'Active', 'Disabled')),
  CONSTRAINT seller_user_location_fk FOREIGN KEY (partner_location_id, partner_id)
    REFERENCES catalogue.partner_location (id, partner_id),
  CONSTRAINT seller_user_id_partner_uq UNIQUE (id, partner_id)
);
CREATE INDEX seller_user_partner_idx ON identity.seller_user (partner_id);
CREATE TRIGGER seller_user_touch BEFORE UPDATE ON identity.seller_user
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- A family is one login on one device. Presenting a refresh token that was already rotated
-- revokes the whole family (reuse detection).
CREATE TABLE identity.refresh_token_family (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    uuid REFERENCES identity.customer (id),
  seller_user_id uuid REFERENCES identity.seller_user (id),
  ops_user_id    uuid REFERENCES identity.ops_user (id),
  device_label   text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_rotated_at timestamptz,
  revoked_at     timestamptz,
  revoked_reason text,
  CONSTRAINT refresh_token_family_one_subject_ck CHECK (
    num_nonnulls(customer_id, seller_user_id, ops_user_id) = 1),
  CONSTRAINT refresh_token_family_revoked_reason_enum CHECK (revoked_reason IN ('logout', 'reuse_detected', 'admin')),
  CONSTRAINT refresh_token_family_revocation_ck CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);

CREATE TABLE identity.refresh_token (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id  uuid NOT NULL REFERENCES identity.refresh_token_family (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refresh_token_hash_uq UNIQUE (token_hash)
);
CREATE INDEX refresh_token_family_idx ON identity.refresh_token (family_id);

CREATE TABLE identity.device_token (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    uuid REFERENCES identity.customer (id),
  seller_user_id uuid REFERENCES identity.seller_user (id),
  ops_user_id    uuid REFERENCES identity.ops_user (id),
  platform       text NOT NULL,
  push_token     text NOT NULL,
  app_version    text,
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_token_one_owner_ck CHECK (num_nonnulls(customer_id, seller_user_id, ops_user_id) = 1),
  CONSTRAINT device_token_platform_enum CHECK (platform IN ('ios', 'android', 'web')),
  CONSTRAINT device_token_push_uq UNIQUE (push_token)
);

CREATE TABLE catalogue.import_job (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id     uuid NOT NULL REFERENCES catalogue.partner (id),
  seller_user_id uuid REFERENCES identity.seller_user (id),
  ops_user_id    uuid REFERENCES identity.ops_user (id),
  file_key       text NOT NULL,
  state          text NOT NULL DEFAULT 'Uploaded',
  total_rows     integer,
  error_rows     integer,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_job_state_enum CHECK (state IN ('Uploaded', 'Validating', 'Validated', 'Imported', 'Failed')),
  CONSTRAINT import_job_uploader_ck CHECK (num_nonnulls(seller_user_id, ops_user_id) = 1),
  CONSTRAINT import_job_counts_ck CHECK (error_rows IS NULL OR (total_rows IS NOT NULL AND error_rows <= total_rows))
);
CREATE INDEX import_job_partner_idx ON catalogue.import_job (partner_id, created_at DESC);
CREATE TRIGGER import_job_touch BEFORE UPDATE ON catalogue.import_job
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE catalogue.import_row (
  import_job_id uuid NOT NULL REFERENCES catalogue.import_job (id) ON DELETE CASCADE,
  row_number    integer NOT NULL,
  raw           jsonb NOT NULL,
  errors        jsonb NOT NULL DEFAULT '[]',
  status        text NOT NULL,
  product_id    text REFERENCES catalogue.product (id),
  offer_id      text REFERENCES catalogue.seller_offer (id),
  CONSTRAINT import_row_pk PRIMARY KEY (import_job_id, row_number),
  CONSTRAINT import_row_status_enum CHECK (status IN ('Valid', 'Invalid', 'Imported')),
  CONSTRAINT import_row_errors_ck CHECK (jsonb_typeof(errors) = 'array'
    AND ((status = 'Invalid') = (jsonb_array_length(errors) > 0)))
);
