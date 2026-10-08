-- Settlement (AID-LOG-014 §8): monthly, per partner, from locked line snapshots.
--   net = gross eligible sales − commission − adjustments (clawbacks of already-settled lines)

CREATE TABLE settlement.settlement_run (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id            uuid NOT NULL REFERENCES catalogue.partner (id),
  period                text NOT NULL,
  state                 text NOT NULL DEFAULT 'Draft',
  gross_fils            bigint NOT NULL DEFAULT 0,
  commission_fils       bigint NOT NULL DEFAULT 0,
  adjustment_fils       bigint NOT NULL DEFAULT 0,
  net_fils              bigint NOT NULL DEFAULT 0,
  approved_by           uuid REFERENCES identity.ops_user (id),
  approved_at           timestamptz,
  paid_at               timestamptz,
  payout_ref            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlement_run_period_uq UNIQUE (partner_id, period),
  CONSTRAINT settlement_run_id_partner_uq UNIQUE (id, partner_id),
  CONSTRAINT settlement_run_period_ck CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT settlement_run_state_enum CHECK (state IN ('Draft', 'Approved', 'Paid')),
  CONSTRAINT settlement_run_amounts_ck CHECK (
    gross_fils >= 0 AND commission_fils >= 0 AND adjustment_fils >= 0 AND commission_fils <= gross_fils),
  -- May be negative: clawbacks beyond this month's sales carry forward.
  CONSTRAINT settlement_run_net_ck CHECK (net_fils = gross_fils - commission_fils - adjustment_fils),
  CONSTRAINT settlement_run_approved_ck CHECK (
    state = 'Draft' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CONSTRAINT settlement_run_paid_ck CHECK ((state = 'Paid') = (paid_at IS NOT NULL))
);
CREATE TRIGGER settlement_run_touch BEFORE UPDATE ON settlement.settlement_run
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

-- A line is settled once as a Sale and at most once more as a Clawback.
CREATE TABLE settlement.settlement_line (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL,
  partner_id      uuid NOT NULL,
  order_line_id   uuid NOT NULL,
  kind            text NOT NULL,
  gross_fils      bigint NOT NULL,
  commission_fils bigint NOT NULL,
  CONSTRAINT settlement_line_run_fk FOREIGN KEY (run_id, partner_id)
    REFERENCES settlement.settlement_run (id, partner_id),
  CONSTRAINT settlement_line_order_line_fk FOREIGN KEY (order_line_id, partner_id)
    REFERENCES fulfilment.order_line (id, partner_id),
  CONSTRAINT settlement_line_kind_enum CHECK (kind IN ('Sale', 'Clawback')),
  CONSTRAINT settlement_line_once_uq UNIQUE (order_line_id, kind),
  CONSTRAINT settlement_line_amounts_ck CHECK (
    gross_fils > 0 AND commission_fils >= 0 AND commission_fils <= gross_fils)
);
CREATE INDEX settlement_line_run_idx ON settlement.settlement_line (run_id);
CREATE TRIGGER settlement_line_append_only BEFORE UPDATE OR DELETE ON settlement.settlement_line
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_modification();

CREATE TABLE settlement.statement (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         uuid NOT NULL,
  partner_id     uuid NOT NULL,
  document_key   text NOT NULL,
  tax_invoice_no text,
  issued_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT statement_run_fk FOREIGN KEY (run_id, partner_id)
    REFERENCES settlement.settlement_run (id, partner_id),
  CONSTRAINT statement_run_uq UNIQUE (run_id)
);
