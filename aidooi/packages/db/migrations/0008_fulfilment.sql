-- Fulfilment (AID-LOG-015): order lines with locked transaction snapshots, and issues.

CREATE TABLE fulfilment.order_line (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_order_id      uuid NOT NULL REFERENCES commerce.master_order (id),
  seller_order_id      uuid NOT NULL,
  partner_id           uuid NOT NULL,
  customer_id          uuid NOT NULL REFERENCES identity.customer (id),
  product_id           text NOT NULL REFERENCES catalogue.product (id),
  offer_id             text NOT NULL,
  quantity             integer NOT NULL,
  unit_price_fils      bigint NOT NULL,
  gross_line_fils      bigint NOT NULL,
  commission_rate      numeric(5, 4) NOT NULL,
  commission_fils      bigint NOT NULL,
  snapshot             jsonb NOT NULL,
  state                text NOT NULL DEFAULT 'Confirmed',
  settlement_state     text NOT NULL DEFAULT 'Not Eligible',
  delivered_at         timestamptz,
  receipt_confirmed_at timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_line_seller_order_fk FOREIGN KEY (seller_order_id, partner_id)
    REFERENCES commerce.seller_order (id, partner_id),
  CONSTRAINT order_line_offer_fk FOREIGN KEY (offer_id, partner_id)
    REFERENCES catalogue.seller_offer (id, partner_id),
  CONSTRAINT order_line_id_partner_uq UNIQUE (id, partner_id),
  CONSTRAINT order_line_state_enum CHECK (state IN
    ('Confirmed', 'Preparing', 'Ready for Dispatch', 'Dispatched', 'Delivered', 'Receipt Confirmed', 'Cancelled', 'Refunded')),
  CONSTRAINT order_line_settlement_state_enum CHECK (settlement_state IN
    ('Not Eligible', 'Eligible', 'On Hold', 'Included', 'Paid', 'Adjusted')),
  CONSTRAINT order_line_quantity_ck CHECK (quantity > 0 AND unit_price_fils > 0),
  CONSTRAINT order_line_gross_ck CHECK (gross_line_fils = unit_price_fils * quantity),
  CONSTRAINT order_line_commission_rate_ck CHECK (commission_rate BETWEEN 0 AND 1),
  -- Commission is rate × gross rounded half-up to the fils, computed in integers so the
  -- database and the domain package cannot disagree by a rounding mode.
  CONSTRAINT order_line_commission_ck CHECK (
    commission_fils = (gross_line_fils * (commission_rate * 10000)::bigint + 5000) / 10000
    AND commission_fils <= gross_line_fils),
  CONSTRAINT order_line_snapshot_ck CHECK (
    jsonb_typeof(snapshot) = 'object'
    AND snapshot ->> 'productId' = product_id
    AND snapshot ->> 'offerId' = offer_id
    AND (snapshot ->> 'quantity')::integer = quantity
    AND (snapshot ->> 'unitPriceFils')::bigint = unit_price_fils),
  CONSTRAINT order_line_delivered_ck CHECK (
    state NOT IN ('Delivered', 'Receipt Confirmed') OR delivered_at IS NOT NULL),
  CONSTRAINT order_line_receipt_ck CHECK (state <> 'Receipt Confirmed' OR receipt_confirmed_at IS NOT NULL),
  CONSTRAINT order_line_settlement_eligibility_ck CHECK (
    settlement_state NOT IN ('Eligible', 'Included', 'Paid') OR state = 'Receipt Confirmed')
);
CREATE INDEX order_line_seller_order_idx ON fulfilment.order_line (seller_order_id);
CREATE INDEX order_line_partner_idx ON fulfilment.order_line (partner_id, created_at DESC);
CREATE INDEX order_line_master_idx ON fulfilment.order_line (master_order_id);
CREATE INDEX order_line_settlement_idx ON fulfilment.order_line (partner_id)
  WHERE settlement_state IN ('Eligible', 'On Hold');
CREATE INDEX order_line_autoconfirm_idx ON fulfilment.order_line (delivered_at) WHERE state = 'Delivered';

CREATE TRIGGER order_line_touch BEFORE UPDATE ON fulfilment.order_line
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
CREATE TRIGGER order_line_state BEFORE UPDATE OF state ON fulfilment.order_line
  FOR EACH ROW EXECUTE FUNCTION platform.enforce_state_transition('order_line', 'state');
-- The transaction snapshot is locked at payment success and never rewritten (AID-LOG-014 §7).
CREATE TRIGGER order_line_snapshot_write_once BEFORE UPDATE ON fulfilment.order_line
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_of(
    'master_order_id', 'seller_order_id', 'partner_id', 'customer_id', 'product_id', 'offer_id',
    'quantity', 'unit_price_fils', 'gross_line_fils', 'commission_rate', 'commission_fils', 'snapshot');
CREATE TRIGGER order_line_no_delete BEFORE DELETE ON fulfilment.order_line
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_delete();

ALTER TABLE commerce.refund
  ADD CONSTRAINT refund_order_line_fk FOREIGN KEY (order_line_id) REFERENCES fulfilment.order_line (id);
ALTER TABLE commerce.confirmation_task
  ADD CONSTRAINT confirmation_task_order_line_fk FOREIGN KEY (order_line_id, partner_id)
    REFERENCES fulfilment.order_line (id, partner_id);

CREATE TABLE fulfilment.issue (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_line_id          uuid NOT NULL,
  partner_id             uuid NOT NULL,
  customer_id            uuid NOT NULL REFERENCES identity.customer (id),
  flag                   text NOT NULL,
  state                  text NOT NULL DEFAULT 'Open',
  note                   text,
  raised_by_customer_id    uuid REFERENCES identity.customer (id),
  raised_by_seller_user_id uuid REFERENCES identity.seller_user (id),
  raised_by_ops_user_id    uuid REFERENCES identity.ops_user (id),
  raised_at              timestamptz NOT NULL DEFAULT now(),
  resolved_at            timestamptz,
  resolution_note        text,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT issue_order_line_fk FOREIGN KEY (order_line_id, partner_id)
    REFERENCES fulfilment.order_line (id, partner_id),
  CONSTRAINT issue_flag_enum CHECK (flag IN
    ('Delayed', 'Delivery Failed', 'Damaged', 'Missing', 'Cancellation Requested', 'Return Requested', 'Disputed')),
  CONSTRAINT issue_state_enum CHECK (state IN ('Open', 'Partner Handling', 'Resolved', 'Refunded', 'Rejected')),
  CONSTRAINT issue_raised_by_ck CHECK (
    num_nonnulls(raised_by_customer_id, raised_by_seller_user_id, raised_by_ops_user_id) <= 1),
  CONSTRAINT issue_resolved_ck CHECK (
    (state = 'Resolved' OR state = 'Refunded' OR state = 'Rejected') = (resolved_at IS NOT NULL))
);
-- One live issue per line and flag; the same problem is not logged twice.
CREATE UNIQUE INDEX issue_live_uq ON fulfilment.issue (order_line_id, flag)
  WHERE state IN ('Open', 'Partner Handling');
CREATE INDEX issue_partner_idx ON fulfilment.issue (partner_id, state);
CREATE TRIGGER issue_touch BEFORE UPDATE ON fulfilment.issue
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
CREATE TRIGGER issue_state BEFORE UPDATE OF state ON fulfilment.issue
  FOR EACH ROW EXECUTE FUNCTION platform.enforce_state_transition('issue', 'state');
CREATE TRIGGER issue_immutable BEFORE UPDATE ON fulfilment.issue
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_of('order_line_id', 'partner_id', 'customer_id', 'flag');
