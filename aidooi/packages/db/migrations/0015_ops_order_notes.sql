-- Internal notes on an order, written by the ops support desk. Append-only: a note is a record of
-- what was known and said at the time, so it is never edited or removed.

CREATE TABLE commerce.order_note (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_order_id uuid NOT NULL REFERENCES commerce.master_order (id),
  ops_user_id     uuid NOT NULL REFERENCES identity.ops_user (id),
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_note_body_ck CHECK (length(btrim(body)) BETWEEN 1 AND 2000)
);
CREATE INDEX order_note_order_idx ON commerce.order_note (master_order_id, created_at);
CREATE TRIGGER order_note_append_only BEFORE UPDATE OR DELETE ON commerce.order_note
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_modification();
REVOKE UPDATE ON commerce.order_note FROM aidooi_app;

-- Notes are for the ops desk only: never visible to buyers or sellers.
ALTER TABLE commerce.order_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce.order_note FORCE ROW LEVEL SECURITY;
CREATE POLICY order_note_privileged ON commerce.order_note
  USING (platform.actor_is_privileged()) WITH CHECK (platform.actor_is_privileged());
