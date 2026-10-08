-- Identity: buyers, guest sessions, operators. PII lives here (and in seller_user), nowhere else
-- except the delivery copy taken at order time (commerce.order_delivery).

CREATE TABLE identity.customer (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164  text,
  email       text,
  full_name   text,
  locale      text NOT NULL DEFAULT 'en',
  status      text NOT NULL DEFAULT 'Active',
  erased_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_locale_enum CHECK (locale IN ('en', 'ar')),
  CONSTRAINT customer_status_enum CHECK (status IN ('Active', 'Erased')),
  CONSTRAINT customer_phone_ck CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT customer_email_ck CHECK (email IS NULL OR email = lower(email)),
  CONSTRAINT customer_contact_ck CHECK (status = 'Erased' OR phone_e164 IS NOT NULL OR email IS NOT NULL),
  CONSTRAINT customer_erasure_ck CHECK ((status = 'Erased') = (erased_at IS NOT NULL))
);
CREATE UNIQUE INDEX customer_phone_uq ON identity.customer (phone_e164) WHERE phone_e164 IS NOT NULL;
CREATE UNIQUE INDEX customer_email_uq ON identity.customer (email) WHERE email IS NOT NULL;
CREATE TRIGGER customer_touch BEFORE UPDATE ON identity.customer
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- A guest session is upgraded in place: customer_id is set at viewing or purchase and the
-- project keeps pointing at the session, so nothing restarts (AID-LOG-013, WF-04 §1).
CREATE TABLE identity.guest_session (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash   text NOT NULL,
  customer_id  uuid REFERENCES identity.customer (id),
  upgraded_at  timestamptz,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guest_session_token_uq UNIQUE (token_hash),
  CONSTRAINT guest_session_upgrade_ck CHECK ((customer_id IS NULL) = (upgraded_at IS NULL))
);
CREATE INDEX guest_session_customer_idx ON identity.guest_session (customer_id) WHERE customer_id IS NOT NULL;

CREATE TABLE identity.customer_address (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES identity.customer (id),
  label       text,
  line1       text NOT NULL,
  line2       text,
  area        text,
  emirate     text NOT NULL,
  country     char(2) NOT NULL DEFAULT 'AE',
  lat         numeric(9, 6),
  lng         numeric(9, 6),
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_address_emirate_enum CHECK (emirate IN
    ('Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah')),
  CONSTRAINT customer_address_geo_ck CHECK ((lat IS NULL) = (lng IS NULL)
    AND (lat IS NULL OR (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)))
);
CREATE UNIQUE INDEX customer_address_default_uq ON identity.customer_address (customer_id) WHERE is_default;
CREATE TRIGGER customer_address_touch BEFORE UPDATE ON identity.customer_address
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE identity.consent (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    uuid NOT NULL REFERENCES identity.customer (id),
  purpose        text NOT NULL,
  policy_version text NOT NULL,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  withdrawn_at   timestamptz,
  CONSTRAINT consent_withdrawn_ck CHECK (withdrawn_at IS NULL OR withdrawn_at >= granted_at)
);
CREATE UNIQUE INDEX consent_active_uq ON identity.consent (customer_id, purpose) WHERE withdrawn_at IS NULL;

CREATE TABLE identity.ops_user (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  full_name   text NOT NULL,
  role        text NOT NULL,
  status      text NOT NULL DEFAULT 'Active',
  mfa_enrolled boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ops_user_email_uq UNIQUE (email),
  CONSTRAINT ops_user_email_ck CHECK (email = lower(email)),
  CONSTRAINT ops_user_role_enum CHECK (role IN ('ops_admin', 'ops_catalogue', 'ops_support', 'ops_finance')),
  CONSTRAINT ops_user_status_enum CHECK (status IN ('Active', 'Disabled'))
);
CREATE TRIGGER ops_user_touch BEFORE UPDATE ON identity.ops_user
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- Only the hash of the code is stored; the destination hash lets us rate-limit per number
-- without keeping the number itself.
CREATE TABLE identity.otp_challenge (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel          text NOT NULL,
  destination_hash text NOT NULL,
  code_hash        text NOT NULL,
  attempts         smallint NOT NULL DEFAULT 0,
  max_attempts     smallint NOT NULL DEFAULT 5,
  expires_at       timestamptz NOT NULL,
  consumed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT otp_challenge_channel_enum CHECK (channel IN ('sms', 'whatsapp', 'email')),
  CONSTRAINT otp_challenge_attempts_ck CHECK (attempts >= 0 AND attempts <= max_attempts)
);
CREATE INDEX otp_challenge_destination_idx ON identity.otp_challenge (destination_hash, created_at DESC);
