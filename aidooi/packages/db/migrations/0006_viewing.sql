-- Viewing (AID-LOG-012 Rev 2): requests, per-location stops, deposit, attribution trail.

CREATE TABLE viewing.viewing_request (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    uuid NOT NULL REFERENCES identity.customer (id),
  project_id     uuid NOT NULL REFERENCES recommendation.project (id),
  composition_id uuid REFERENCES recommendation.composition (id),
  state          text NOT NULL DEFAULT 'Draft',
  qr_token_hash  text,
  scheduled_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT viewing_request_state_enum CHECK (state IN
    ('Draft', 'Awaiting Seller Confirmation', 'Awaiting Deposit', 'Confirmed', 'Completed', 'No-show', 'Cancelled')),
  CONSTRAINT viewing_request_qr_uq UNIQUE (qr_token_hash),
  CONSTRAINT viewing_request_confirmed_ck CHECK (
    state NOT IN ('Confirmed', 'Completed', 'No-show') OR (qr_token_hash IS NOT NULL AND scheduled_at IS NOT NULL))
);
CREATE INDEX viewing_request_customer_idx ON viewing.viewing_request (customer_id, created_at DESC);
CREATE TRIGGER viewing_request_touch BEFORE UPDATE ON viewing.viewing_request
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
CREATE TRIGGER viewing_request_state BEFORE UPDATE OF state ON viewing.viewing_request
  FOR EACH ROW EXECUTE FUNCTION platform.enforce_state_transition('viewing_request', 'state');

-- Stops group products by physical partner location to minimise the customer's trips.
CREATE TABLE viewing.viewing_stop (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viewing_request_id  uuid NOT NULL REFERENCES viewing.viewing_request (id),
  partner_id          uuid NOT NULL REFERENCES catalogue.partner (id),
  partner_location_id uuid NOT NULL,
  stop_no             smallint NOT NULL,
  confirmation_state  text NOT NULL DEFAULT 'Pending',
  responded_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT viewing_stop_location_fk FOREIGN KEY (partner_location_id, partner_id)
    REFERENCES catalogue.partner_location (id, partner_id),
  CONSTRAINT viewing_stop_confirmation_state_enum CHECK (confirmation_state IN ('Pending', 'Confirmed', 'Declined')),
  CONSTRAINT viewing_stop_no_uq UNIQUE (viewing_request_id, stop_no),
  CONSTRAINT viewing_stop_location_uq UNIQUE (viewing_request_id, partner_location_id),
  CONSTRAINT viewing_stop_id_partner_uq UNIQUE (id, partner_id),
  CONSTRAINT viewing_stop_responded_ck CHECK ((confirmation_state = 'Pending') = (responded_at IS NULL))
);
CREATE INDEX viewing_stop_partner_idx ON viewing.viewing_stop (partner_id, created_at DESC);

CREATE TABLE viewing.viewing_product (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stop_id        uuid NOT NULL,
  partner_id     uuid NOT NULL,
  offer_id       text NOT NULL,
  product_id     text NOT NULL REFERENCES catalogue.product (id),
  quantity       integer NOT NULL DEFAULT 1,
  unit_price_fils bigint NOT NULL,
  CONSTRAINT viewing_product_stop_fk FOREIGN KEY (stop_id, partner_id)
    REFERENCES viewing.viewing_stop (id, partner_id),
  CONSTRAINT viewing_product_offer_fk FOREIGN KEY (offer_id, partner_id)
    REFERENCES catalogue.seller_offer (id, partner_id),
  CONSTRAINT viewing_product_offer_uq UNIQUE (stop_id, offer_id),
  CONSTRAINT viewing_product_quantity_ck CHECK (quantity > 0),
  CONSTRAINT viewing_product_price_ck CHECK (unit_price_fils > 0)
);

-- Deposit rule (AID-LOG-012 §5): 5% of the selected products' selling price, capped at AED 500,
-- rounded half-up to the fils. The CHECK is the standard, not a convenience: a deposit that
-- disagrees with it cannot be stored.
CREATE TABLE viewing.viewing_deposit (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viewing_request_id uuid NOT NULL REFERENCES viewing.viewing_request (id),
  basis_fils         bigint NOT NULL,
  amount_fils        bigint NOT NULL,
  capped             boolean NOT NULL,
  state              text NOT NULL DEFAULT 'Pending',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT viewing_deposit_request_uq UNIQUE (viewing_request_id),
  CONSTRAINT viewing_deposit_state_enum CHECK (state IN ('Pending', 'Paid', 'Credited', 'Refunded', 'Non-refundable')),
  CONSTRAINT viewing_deposit_basis_ck CHECK (basis_fils > 0),
  CONSTRAINT viewing_deposit_amount_ck CHECK (amount_fils = LEAST((basis_fils * 5 + 50) / 100, 50000)),
  CONSTRAINT viewing_deposit_capped_ck CHECK (capped = ((basis_fils * 5 + 50) / 100 > 50000))
);
CREATE TRIGGER viewing_deposit_touch BEFORE UPDATE ON viewing.viewing_deposit
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
CREATE TRIGGER viewing_deposit_immutable BEFORE UPDATE ON viewing.viewing_deposit
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_of('viewing_request_id', 'basis_fils', 'amount_fils', 'capped');
CREATE TRIGGER viewing_deposit_state BEFORE UPDATE OF state ON viewing.viewing_deposit
  FOR EACH ROW EXECUTE FUNCTION platform.enforce_state_transition('viewing_deposit', 'state');

-- Append-only: a direct partner sale after an AIDOOi viewing must stay attributable.
CREATE TABLE viewing.attribution_event (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viewing_request_id uuid NOT NULL REFERENCES viewing.viewing_request (id),
  stage              text NOT NULL,
  at                 timestamptz NOT NULL DEFAULT now(),
  note               text,
  CONSTRAINT attribution_event_stage_enum CHECK (stage IN
    ('Recommended', 'Requested', 'Confirmed', 'Viewed', 'Purchased', 'Not Purchased'))
);
CREATE INDEX attribution_event_request_idx ON viewing.attribution_event (viewing_request_id, at);
CREATE TRIGGER attribution_event_append_only BEFORE UPDATE OR DELETE ON viewing.attribution_event
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_modification();
