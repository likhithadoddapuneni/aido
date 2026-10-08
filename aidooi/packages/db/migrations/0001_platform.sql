-- Platform foundation: schemas, roles, shared trigger functions, state-transition registry,
-- durable jobs, transactional outbox, idempotency keys, feature flags.

CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA identity;
CREATE SCHEMA catalogue;
CREATE SCHEMA recommendation;
CREATE SCHEMA viewing;
CREATE SCHEMA commerce;
CREATE SCHEMA fulfilment;
CREATE SCHEMA settlement;
CREATE SCHEMA audit;

-- Roles are cluster-wide, so creation must tolerate other databases (and parallel test databases)
-- having created them first. Both are NOLOGIN: deployments grant them to a login role.
DO $$
BEGIN
  BEGIN
    CREATE ROLE aidooi_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    CREATE ROLE aidooi_readonly NOLOGIN NOSUPERUSER NOBYPASSRLS;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION platform.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- Rejects any UPDATE that changes one of the columns named in TG_ARGV.
CREATE FUNCTION platform.forbid_update_of() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  col text;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF to_jsonb(NEW) -> col IS DISTINCT FROM to_jsonb(OLD) -> col THEN
      RAISE EXCEPTION '%.%: column "%" is write-once', TG_TABLE_SCHEMA, TG_TABLE_NAME, col
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;

CREATE FUNCTION platform.forbid_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%.%: rows are never deleted (use a status column)', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END
$$;

CREATE FUNCTION platform.forbid_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%.%: table is append-only (% rejected)', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END
$$;

-- ---------------------------------------------------------------------------------------------
-- State machines: the legal-edge registry and the trigger that enforces it.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE platform.state_transition (
  machine    text NOT NULL,
  from_state text NOT NULL,
  to_state   text NOT NULL,
  CONSTRAINT state_transition_pk PRIMARY KEY (machine, from_state, to_state),
  CONSTRAINT state_transition_not_self_ck CHECK (from_state <> to_state)
);

INSERT INTO platform.state_transition (machine, from_state, to_state) VALUES
  ('viewing_request', 'Draft', 'Awaiting Seller Confirmation'),
  ('viewing_request', 'Draft', 'Awaiting Deposit'),
  ('viewing_request', 'Draft', 'Cancelled'),
  ('viewing_request', 'Awaiting Seller Confirmation', 'Awaiting Deposit'),
  ('viewing_request', 'Awaiting Seller Confirmation', 'Cancelled'),
  ('viewing_request', 'Awaiting Deposit', 'Confirmed'),
  ('viewing_request', 'Awaiting Deposit', 'Cancelled'),
  ('viewing_request', 'Confirmed', 'Completed'),
  ('viewing_request', 'Confirmed', 'No-show'),
  ('viewing_request', 'Confirmed', 'Cancelled'),
  ('viewing_deposit', 'Pending', 'Paid'),
  ('viewing_deposit', 'Paid', 'Credited'),
  ('viewing_deposit', 'Paid', 'Refunded'),
  ('viewing_deposit', 'Paid', 'Non-refundable'),
  ('reservation', 'Active', 'Converted'),
  ('reservation', 'Active', 'Released'),
  ('reservation', 'Active', 'Expired'),
  ('payment', 'Pending', 'Authorized'),
  ('payment', 'Pending', 'Failed'),
  ('payment', 'Authorized', 'Successful'),
  ('payment', 'Authorized', 'Voided'),
  ('payment', 'Authorized', 'Failed'),
  ('payment', 'Successful', 'Refunded'),
  ('order_line', 'Confirmed', 'Preparing'),
  ('order_line', 'Confirmed', 'Cancelled'),
  ('order_line', 'Confirmed', 'Refunded'),
  ('order_line', 'Preparing', 'Ready for Dispatch'),
  ('order_line', 'Preparing', 'Cancelled'),
  ('order_line', 'Preparing', 'Refunded'),
  ('order_line', 'Ready for Dispatch', 'Dispatched'),
  ('order_line', 'Ready for Dispatch', 'Cancelled'),
  ('order_line', 'Ready for Dispatch', 'Refunded'),
  ('order_line', 'Dispatched', 'Delivered'),
  ('order_line', 'Dispatched', 'Refunded'),
  ('order_line', 'Delivered', 'Receipt Confirmed'),
  ('order_line', 'Delivered', 'Refunded'),
  ('order_line', 'Receipt Confirmed', 'Refunded'),
  ('issue', 'Open', 'Partner Handling'),
  ('issue', 'Open', 'Resolved'),
  ('issue', 'Open', 'Refunded'),
  ('issue', 'Open', 'Rejected'),
  ('issue', 'Partner Handling', 'Resolved'),
  ('issue', 'Partner Handling', 'Refunded'),
  ('issue', 'Partner Handling', 'Rejected');

-- TG_ARGV[0] = machine name, TG_ARGV[1] = state column. Same-state updates are always allowed.
CREATE FUNCTION platform.enforce_state_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_state text := to_jsonb(OLD) ->> TG_ARGV[1];
  new_state text := to_jsonb(NEW) ->> TG_ARGV[1];
BEGIN
  IF new_state IS NOT DISTINCT FROM old_state THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM platform.state_transition
    WHERE machine = TG_ARGV[0] AND from_state = old_state AND to_state = new_state
  ) THEN
    RAISE EXCEPTION 'illegal % transition: % -> %', TG_ARGV[0], old_state, new_state
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------------------------
-- Actor context (set per transaction by the application; see src/context.ts)
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION platform.actor_kind() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.actor_kind', true), '') $$;

CREATE FUNCTION platform.actor_partner() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.partner_id', true), '')::uuid $$;

CREATE FUNCTION platform.actor_customer() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.customer_id', true), '')::uuid $$;

-- ---------------------------------------------------------------------------------------------
-- Durable jobs: Postgres is the queue. The row is the truth; workers only lease it.
-- ---------------------------------------------------------------------------------------------

CREATE TABLE platform.job (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  run_at       timestamptz NOT NULL DEFAULT now(),
  status       text NOT NULL DEFAULT 'Pending',
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  locked_by    text,
  locked_until timestamptz,
  last_error   text,
  dedupe_key   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_status_enum CHECK (status IN ('Pending', 'Running', 'Succeeded', 'Failed', 'Dead')),
  CONSTRAINT job_attempts_ck CHECK (attempts >= 0 AND max_attempts >= 1),
  CONSTRAINT job_lease_ck CHECK ((status = 'Running') = (locked_by IS NOT NULL AND locked_until IS NOT NULL))
);

-- A dedupe key is unique only while the job can still run, so the same logical job (for example
-- "expire reservation X") can be scheduled again after it finished.
CREATE UNIQUE INDEX job_dedupe_live_uq ON platform.job (dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('Pending', 'Running', 'Failed');
CREATE INDEX job_runnable_idx ON platform.job (run_at, created_at)
  WHERE status IN ('Pending', 'Failed', 'Running');

CREATE TRIGGER job_touch BEFORE UPDATE ON platform.job
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE platform.outbox_event (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic         text NOT NULL,
  aggregate_id  text NOT NULL,
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz
);
CREATE INDEX outbox_event_unpublished_idx ON platform.outbox_event (created_at)
  WHERE published_at IS NULL;

CREATE TABLE platform.idempotency_key (
  key           text NOT NULL,
  scope         text NOT NULL,
  request_hash  text NOT NULL,
  status        text NOT NULL DEFAULT 'InProgress',
  response      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  CONSTRAINT idempotency_key_pk PRIMARY KEY (scope, key),
  CONSTRAINT idempotency_key_status_enum CHECK (status IN ('InProgress', 'Completed')),
  CONSTRAINT idempotency_key_response_ck CHECK ((status = 'Completed') = (response IS NOT NULL))
);
CREATE INDEX idempotency_key_expiry_idx ON platform.idempotency_key (expires_at);

CREATE TABLE platform.feature_flag (
  key         text PRIMARY KEY,
  enabled     boolean NOT NULL DEFAULT false,
  rollout_pct smallint NOT NULL DEFAULT 0,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feature_flag_rollout_ck CHECK (rollout_pct BETWEEN 0 AND 100)
);
CREATE TRIGGER feature_flag_touch BEFORE UPDATE ON platform.feature_flag
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
