-- Audit: append-only, monthly partitions. Written in the same transaction as the change it
-- describes (audit.record), so a state change without its audit row cannot commit.

CREATE TABLE audit.event (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  at             timestamptz NOT NULL DEFAULT now(),
  entity_type    text NOT NULL,
  entity_id      text NOT NULL,
  from_state     text,
  to_state       text,
  actor_type     text NOT NULL,
  actor_id       text,
  reason         text,
  correlation_id text,
  data           jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT event_pk PRIMARY KEY (id, at),
  CONSTRAINT event_actor_type_enum CHECK (actor_type IN ('customer', 'guest', 'seller_user', 'ops_user', 'system'))
) PARTITION BY RANGE (at);

CREATE INDEX event_entity_idx ON audit.event (entity_type, entity_id, at);
CREATE INDEX event_correlation_idx ON audit.event (correlation_id) WHERE correlation_id IS NOT NULL;

CREATE TABLE audit.event_default PARTITION OF audit.event DEFAULT;

CREATE FUNCTION audit.reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit.event is append-only (% rejected)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END
$$;

CREATE TRIGGER event_no_update_delete BEFORE UPDATE OR DELETE ON audit.event
  FOR EACH ROW EXECUTE FUNCTION audit.reject_change();
CREATE TRIGGER event_no_truncate BEFORE TRUNCATE ON audit.event
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_change();
CREATE TRIGGER event_default_no_truncate BEFORE TRUNCATE ON audit.event_default
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_change();

-- SECURITY DEFINER because the application role has no DDL rights.
-- Creates partitions for the current month and the next p_months_ahead. Idempotent; run monthly
-- from a scheduled job. Fails loudly if the default partition already holds rows for a month
-- that is being created (PostgreSQL refuses), which means the job did not run in time.
CREATE FUNCTION audit.ensure_partitions(p_months_ahead integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  m        date := date_trunc('month', now())::date;
  created  integer := 0;
  part     text;
  i        integer;
BEGIN
  FOR i IN 0..p_months_ahead LOOP
    part := format('event_y%sm%s', to_char(m, 'YYYY'), to_char(m, 'MM'));
    IF to_regclass(format('audit.%I', part)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE audit.%I PARTITION OF audit.event FOR VALUES FROM (%L) TO (%L)',
        part, m::timestamptz, (m + interval '1 month')::timestamptz);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE TRUNCATE ON audit.%I FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_change()',
        part || '_no_truncate', part);
      created := created + 1;
    END IF;
    m := (m + interval '1 month')::date;
  END LOOP;
  RETURN created;
END
$$;

SELECT audit.ensure_partitions(3);

-- The only supported write path. correlation_id defaults to the transaction's app.correlation_id.
CREATE FUNCTION audit.record(
  p_entity_type text, p_entity_id text, p_from_state text, p_to_state text,
  p_actor_type text, p_actor_id text, p_reason text DEFAULT NULL, p_data jsonb DEFAULT '{}'
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO audit.event (id, entity_type, entity_id, from_state, to_state, actor_type, actor_id,
                           reason, correlation_id, data)
  VALUES (v_id, p_entity_type, p_entity_id, p_from_state, p_to_state, p_actor_type, p_actor_id,
          p_reason, nullif(current_setting('app.correlation_id', true), ''), p_data);
  RETURN v_id;
END
$$;
