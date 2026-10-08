-- Staff authentication (sellers and ops) and social sign-in links.
-- Credentials live apart from seller_user/ops_user so the user rows stay free of secrets and the
-- tables readable by partner-scoped queries never contain a hash.

CREATE TABLE identity.staff_credential (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_user_id         uuid REFERENCES identity.seller_user (id),
  ops_user_id            uuid REFERENCES identity.ops_user (id),
  password_hash          text NOT NULL,
  -- AES-256-GCM, base64(iv || tag || ciphertext). Null until MFA enrolment starts.
  totp_secret_ciphertext text,
  totp_confirmed_at      timestamptz,
  -- Highest accepted RFC 6238 time step: a code is single-use even inside its validity window.
  last_totp_step         integer,
  failed_attempts        integer NOT NULL DEFAULT 0,
  locked_until           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_credential_one_subject_ck CHECK (num_nonnulls(seller_user_id, ops_user_id) = 1),
  CONSTRAINT staff_credential_seller_uq UNIQUE (seller_user_id),
  CONSTRAINT staff_credential_ops_uq UNIQUE (ops_user_id),
  CONSTRAINT staff_credential_totp_ck CHECK (totp_confirmed_at IS NULL OR totp_secret_ciphertext IS NOT NULL),
  CONSTRAINT staff_credential_failed_ck CHECK (failed_attempts >= 0)
);
CREATE TRIGGER staff_credential_touch BEFORE UPDATE ON identity.staff_credential
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- Only the SHA-256 of the invite token is stored; it is shown once, at creation.
CREATE TABLE identity.staff_invite (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_user_id uuid REFERENCES identity.seller_user (id),
  ops_user_id    uuid REFERENCES identity.ops_user (id),
  token_hash     text NOT NULL,
  expires_at     timestamptz NOT NULL,
  consumed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_invite_one_subject_ck CHECK (num_nonnulls(seller_user_id, ops_user_id) = 1),
  CONSTRAINT staff_invite_token_uq UNIQUE (token_hash)
);
CREATE INDEX staff_invite_seller_idx ON identity.staff_invite (seller_user_id) WHERE seller_user_id IS NOT NULL;
CREATE INDEX staff_invite_ops_idx ON identity.staff_invite (ops_user_id) WHERE ops_user_id IS NOT NULL;

CREATE TABLE identity.oauth_identity (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    text NOT NULL,
  subject     text NOT NULL,
  customer_id uuid NOT NULL REFERENCES identity.customer (id),
  email       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oauth_identity_provider_ck CHECK (provider ~ '^(apple|google)$'),
  CONSTRAINT oauth_identity_subject_uq UNIQUE (provider, subject),
  CONSTRAINT oauth_identity_customer_idx_uq UNIQUE (customer_id, provider)
);

-- Credentials are never visible to a user context; the platform actor handles sign-in.
ALTER TABLE identity.staff_credential ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.staff_credential FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_credential_system ON identity.staff_credential
  USING (platform.actor_kind() = 'system') WITH CHECK (platform.actor_kind() = 'system');

ALTER TABLE identity.staff_invite ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.staff_invite FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_invite_privileged ON identity.staff_invite
  USING (platform.actor_is_privileged()) WITH CHECK (platform.actor_is_privileged());

ALTER TABLE identity.oauth_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.oauth_identity FORCE ROW LEVEL SECURITY;
CREATE POLICY oauth_identity_access ON identity.oauth_identity
  USING (platform.actor_is_privileged() OR platform.actor_owns_customer(customer_id))
  WITH CHECK (platform.actor_is_privileged() OR platform.actor_owns_customer(customer_id));

-- Erasure removes a customer's linked provider identities.
GRANT DELETE ON identity.oauth_identity TO aidooi_app;
