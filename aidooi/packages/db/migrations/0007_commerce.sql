-- Commerce (AID-LOG-014): purchase requests, stock reservations, one payment per checkout,
-- the double-entry ledger, and the master → seller order split.
-- order_line lives in the fulfilment schema (0008) and links back here.

CREATE TABLE commerce.purchase_request (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        uuid NOT NULL REFERENCES identity.customer (id),
  project_id         uuid REFERENCES recommendation.project (id),
  composition_id     uuid REFERENCES recommendation.composition (id),
  viewing_request_id uuid REFERENCES viewing.viewing_request (id),
  validation_state   text NOT NULL DEFAULT 'Validation Pending',
  total_fils         bigint NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_request_validation_state_enum CHECK (validation_state IN
    ('Validation Pending', 'Validated', 'Rebuild Required')),
  CONSTRAINT purchase_request_total_ck CHECK (total_fils > 0)
);
CREATE TRIGGER purchase_request_touch BEFORE UPDATE ON commerce.purchase_request
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE TABLE commerce.purchase_request_line (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_request_id uuid NOT NULL REFERENCES commerce.purchase_request (id) ON DELETE CASCADE,
  offer_id            text NOT NULL REFERENCES catalogue.seller_offer (id),
  quantity            integer NOT NULL,
  quoted_unit_price_fils bigint NOT NULL,
  CONSTRAINT purchase_request_line_offer_uq UNIQUE (purchase_request_id, offer_id),
  CONSTRAINT purchase_request_line_quantity_ck CHECK (quantity > 0),
  CONSTRAINT purchase_request_line_price_ck CHECK (quoted_unit_price_fils > 0)
);

-- The purchase window: last seller confirmation + 24h, set by the application.
CREATE TABLE commerce.reservation (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_request_id uuid NOT NULL REFERENCES commerce.purchase_request (id),
  state               text NOT NULL DEFAULT 'Active',
  started_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reservation_state_enum CHECK (state IN ('Active', 'Converted', 'Released', 'Expired')),
  CONSTRAINT reservation_window_ck CHECK (expires_at > started_at)
);
CREATE UNIQUE INDEX reservation_one_active_uq ON commerce.reservation (purchase_request_id) WHERE state = 'Active';
CREATE INDEX reservation_expiry_idx ON commerce.reservation (expires_at) WHERE state = 'Active';
CREATE TRIGGER reservation_touch BEFORE UPDATE ON commerce.reservation
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
CREATE TRIGGER reservation_state BEFORE UPDATE OF state ON commerce.reservation
  FOR EACH ROW EXECUTE FUNCTION platform.enforce_state_transition('reservation', 'state');

CREATE TABLE commerce.reservation_line (
  reservation_id uuid NOT NULL REFERENCES commerce.reservation (id) ON DELETE CASCADE,
  offer_id       text NOT NULL REFERENCES catalogue.seller_offer (id),
  quantity       integer NOT NULL,
  CONSTRAINT reservation_line_pk PRIMARY KEY (reservation_id, offer_id),
  CONSTRAINT reservation_line_quantity_ck CHECK (quantity > 0)
);
CREATE INDEX reservation_line_offer_idx ON commerce.reservation_line (offer_id);

-- Stock held by live reservations. A reservation past expires_at stops counting immediately,
-- even before the expiry job flips its state.
CREATE VIEW commerce.reserved_qty WITH (security_invoker = true) AS
SELECT rl.offer_id, sum(rl.quantity)::integer AS reserved
FROM commerce.reservation_line rl
JOIN commerce.reservation r ON r.id = rl.reservation_id
WHERE r.state = 'Active' AND r.expires_at > now()
GROUP BY rl.offer_id;

CREATE FUNCTION commerce.assert_system_actor() RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF platform.actor_kind() IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'only the system actor may move stock' USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;

-- Reserve p_qty of an offer for a reservation without overselling. The offer row lock serialises
-- competing reservations, and stock is compared against everyone else's live holds. Stock itself
-- is only decremented at payment (consume_reservation). Checkout is a platform action, so both
-- functions insist on the 'system' actor: a buyer or seller context cannot move stock.
CREATE FUNCTION commerce.try_reserve(p_reservation_id uuid, p_offer_id text, p_qty integer)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  v_stock    integer;
  v_reserved integer;
BEGIN
  PERFORM commerce.assert_system_actor();
  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM 1 FROM commerce.reservation
   WHERE id = p_reservation_id AND state = 'Active' AND expires_at > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation % is not active', p_reservation_id USING ERRCODE = 'check_violation';
  END IF;

  SELECT stock_qty INTO v_stock FROM catalogue.seller_offer
   WHERE id = p_offer_id AND offer_status = 'Active' AND availability <> 'Out of Stock'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT coalesce(sum(rl.quantity), 0) INTO v_reserved
    FROM commerce.reservation_line rl
    JOIN commerce.reservation r ON r.id = rl.reservation_id
   WHERE rl.offer_id = p_offer_id AND rl.reservation_id <> p_reservation_id
     AND r.state = 'Active' AND r.expires_at > now();

  IF v_stock - v_reserved < p_qty THEN
    RETURN false;
  END IF;

  INSERT INTO commerce.reservation_line (reservation_id, offer_id, quantity)
  VALUES (p_reservation_id, p_offer_id, p_qty)
  ON CONFLICT (reservation_id, offer_id) DO UPDATE SET quantity = EXCLUDED.quantity;
  RETURN true;
END
$$;

-- On payment success: decrement stock for every line, mark sold-out offers, convert the
-- reservation. All in the caller's transaction, so stock and order cannot diverge.
CREATE FUNCTION commerce.consume_reservation(p_reservation_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  line record;
BEGIN
  PERFORM commerce.assert_system_actor();
  FOR line IN
    SELECT rl.offer_id, rl.quantity FROM commerce.reservation_line rl
     WHERE rl.reservation_id = p_reservation_id ORDER BY rl.offer_id
  LOOP
    UPDATE catalogue.seller_offer
       SET stock_qty = stock_qty - line.quantity,
           availability = CASE WHEN stock_qty - line.quantity = 0 THEN 'Out of Stock' ELSE availability END
     WHERE id = line.offer_id AND stock_qty >= line.quantity;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'offer % no longer has % units', line.offer_id, line.quantity
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  UPDATE commerce.reservation SET state = 'Converted' WHERE id = p_reservation_id;
END
$$;

CREATE TABLE commerce.payment (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose             text NOT NULL,
  customer_id         uuid NOT NULL REFERENCES identity.customer (id),
  purchase_request_id uuid REFERENCES commerce.purchase_request (id),
  viewing_deposit_id  uuid REFERENCES viewing.viewing_deposit (id),
  state               text NOT NULL DEFAULT 'Pending',
  provider            text NOT NULL DEFAULT 'mock',
  provider_ref        text,
  amount_fils         bigint NOT NULL,
  currency            char(3) NOT NULL DEFAULT 'AED',
  idempotency_key     text NOT NULL,
  authorized_at       timestamptz,
  captured_at         timestamptz,
  voided_at           timestamptz,
  failure_code        text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_purpose_enum CHECK (purpose IN ('Order', 'ViewingDeposit')),
  CONSTRAINT payment_state_enum CHECK (state IN
    ('Pending', 'Authorized', 'Successful', 'Failed', 'Voided', 'Refunded')),
  CONSTRAINT payment_subject_ck CHECK (
    (purpose = 'Order' AND purchase_request_id IS NOT NULL AND viewing_deposit_id IS NULL)
    OR (purpose = 'ViewingDeposit' AND viewing_deposit_id IS NOT NULL AND purchase_request_id IS NULL)),
  CONSTRAINT payment_amount_ck CHECK (amount_fils > 0),
  CONSTRAINT payment_currency_ck CHECK (currency = 'AED'),
  CONSTRAINT payment_idempotency_uq UNIQUE (idempotency_key),
  CONSTRAINT payment_captured_ck CHECK (state NOT IN ('Successful', 'Refunded') OR captured_at IS NOT NULL),
  CONSTRAINT payment_voided_ck CHECK ((state = 'Voided') = (voided_at IS NOT NULL))
);
CREATE UNIQUE INDEX payment_provider_ref_uq ON commerce.payment (provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX payment_customer_idx ON commerce.payment (customer_id, created_at DESC);
CREATE TRIGGER payment_touch BEFORE UPDATE ON commerce.payment
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();
CREATE TRIGGER payment_state BEFORE UPDATE OF state ON commerce.payment
  FOR EACH ROW EXECUTE FUNCTION platform.enforce_state_transition('payment', 'state');
CREATE TRIGGER payment_immutable BEFORE UPDATE ON commerce.payment
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_update_of(
    'purpose', 'customer_id', 'purchase_request_id', 'viewing_deposit_id', 'amount_fils', 'currency', 'idempotency_key');

-- Gate: no capture before every required seller validation (AID-LOG-014 §3).
CREATE FUNCTION commerce.assert_capture_allowed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.purpose = 'Order' AND NEW.state = 'Successful' AND OLD.state IS DISTINCT FROM 'Successful' THEN
    IF NOT EXISTS (
      SELECT 1 FROM commerce.purchase_request
       WHERE id = NEW.purchase_request_id AND validation_state = 'Validated'
    ) THEN
      RAISE EXCEPTION 'payment % cannot succeed: purchase request is not fully validated', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER payment_capture_gate BEFORE UPDATE OF state ON commerce.payment
  FOR EACH ROW EXECUTE FUNCTION commerce.assert_capture_allowed();

CREATE TABLE commerce.payment_attempt (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id        uuid NOT NULL REFERENCES commerce.payment (id),
  kind              text NOT NULL,
  outcome           text NOT NULL,
  provider_event_id text,
  request           jsonb,
  response          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_attempt_kind_enum CHECK (kind IN ('authorize', 'capture', 'void', 'refund')),
  CONSTRAINT payment_attempt_outcome_enum CHECK (outcome IN ('Succeeded', 'Failed', 'Pending'))
);
-- Provider webhooks are delivered at least once; this makes recording one idempotent.
CREATE UNIQUE INDEX payment_attempt_event_uq ON commerce.payment_attempt (provider_event_id)
  WHERE provider_event_id IS NOT NULL;
CREATE INDEX payment_attempt_payment_idx ON commerce.payment_attempt (payment_id, created_at);
CREATE TRIGGER payment_attempt_append_only BEFORE UPDATE OR DELETE ON commerce.payment_attempt
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_modification();

CREATE TABLE commerce.refund (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id   uuid NOT NULL REFERENCES commerce.payment (id),
  order_line_id uuid,
  amount_fils  bigint NOT NULL,
  reason       text NOT NULL,
  state        text NOT NULL DEFAULT 'Pending',
  provider_ref text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refund_state_enum CHECK (state IN ('Pending', 'Succeeded', 'Failed')),
  CONSTRAINT refund_amount_ck CHECK (amount_fils > 0)
);
CREATE INDEX refund_payment_idx ON commerce.refund (payment_id);
CREATE TRIGGER refund_touch BEFORE UPDATE ON commerce.refund
  FOR EACH ROW EXECUTE FUNCTION platform.touch_updated_at();

CREATE FUNCTION commerce.assert_refunds_within_payment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_amount bigint;
  v_refunded bigint;
BEGIN
  SELECT amount_fils INTO v_amount FROM commerce.payment WHERE id = NEW.payment_id FOR SHARE;
  SELECT coalesce(sum(amount_fils), 0) INTO v_refunded
    FROM commerce.refund WHERE payment_id = NEW.payment_id AND state <> 'Failed';
  IF v_refunded > v_amount THEN
    RAISE EXCEPTION 'refunds (%) exceed payment amount (%) for payment %', v_refunded, v_amount, NEW.payment_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER refund_within_payment AFTER INSERT OR UPDATE ON commerce.refund
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION commerce.assert_refunds_within_payment();

-- Money movements, double entry. Amounts are positive; direction carries the sign. Every
-- entry_group must balance by commit time.
CREATE TABLE commerce.ledger_entry (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_group uuid NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  account     text NOT NULL,
  direction   text NOT NULL,
  amount_fils bigint NOT NULL,
  ref_type    text NOT NULL,
  ref_id      text NOT NULL,
  memo        text,
  CONSTRAINT ledger_entry_direction_enum CHECK (direction IN ('debit', 'credit')),
  CONSTRAINT ledger_entry_amount_ck CHECK (amount_fils > 0)
);
CREATE INDEX ledger_entry_group_idx ON commerce.ledger_entry (entry_group);
CREATE INDEX ledger_entry_account_idx ON commerce.ledger_entry (account, at);
CREATE TRIGGER ledger_entry_append_only BEFORE UPDATE OR DELETE ON commerce.ledger_entry
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_modification();

CREATE FUNCTION commerce.assert_ledger_group_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_net bigint;
BEGIN
  SELECT coalesce(sum(CASE direction WHEN 'debit' THEN amount_fils ELSE -amount_fils END), 0)
    INTO v_net FROM commerce.ledger_entry WHERE entry_group = NEW.entry_group;
  IF v_net <> 0 THEN
    RAISE EXCEPTION 'ledger entry group % is unbalanced by % fils', NEW.entry_group, v_net
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER ledger_entry_balanced AFTER INSERT ON commerce.ledger_entry
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce.assert_ledger_group_balanced();

-- One checkout, one payment, one customer-facing order. payment_id is null only when a viewing
-- deposit credit covers the whole order (paid_fils = 0).
CREATE TABLE commerce.master_order (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         uuid NOT NULL REFERENCES identity.customer (id),
  payment_id          uuid REFERENCES commerce.payment (id),
  purchase_request_id uuid NOT NULL REFERENCES commerce.purchase_request (id),
  viewing_request_id  uuid REFERENCES viewing.viewing_request (id),
  gross_fils          bigint NOT NULL,
  deposit_credit_fils bigint NOT NULL DEFAULT 0,
  paid_fils           bigint NOT NULL,
  placed_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT master_order_payment_uq UNIQUE (payment_id),
  CONSTRAINT master_order_request_uq UNIQUE (purchase_request_id),
  CONSTRAINT master_order_amounts_ck CHECK (
    gross_fils > 0 AND deposit_credit_fils >= 0 AND deposit_credit_fils <= gross_fils
    AND paid_fils = gross_fils - deposit_credit_fils),
  CONSTRAINT master_order_payment_ck CHECK ((paid_fils = 0) = (payment_id IS NULL)),
  CONSTRAINT master_order_credit_ck CHECK (deposit_credit_fils = 0 OR viewing_request_id IS NOT NULL)
);
CREATE INDEX master_order_customer_idx ON commerce.master_order (customer_id, placed_at DESC);
CREATE TRIGGER master_order_immutable BEFORE UPDATE ON commerce.master_order
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_modification();

-- Gate: no seller fulfilment before a complete, successful payment.
CREATE FUNCTION commerce.assert_order_paid() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  p commerce.payment;
BEGIN
  IF NEW.payment_id IS NOT NULL THEN
    SELECT * INTO p FROM commerce.payment WHERE id = NEW.payment_id;
    IF NOT FOUND OR p.state <> 'Successful' OR p.amount_fils <> NEW.paid_fils OR p.customer_id <> NEW.customer_id
       OR p.purchase_request_id IS DISTINCT FROM NEW.purchase_request_id THEN
      RAISE EXCEPTION 'order requires a successful payment matching the order (payment %)', NEW.payment_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER master_order_paid_gate BEFORE INSERT ON commerce.master_order
  FOR EACH ROW EXECUTE FUNCTION commerce.assert_order_paid();

CREATE TABLE commerce.seller_order (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_order_id uuid NOT NULL REFERENCES commerce.master_order (id),
  partner_id      uuid NOT NULL REFERENCES catalogue.partner (id),
  customer_id     uuid NOT NULL REFERENCES identity.customer (id),
  subtotal_fils   bigint NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seller_order_partner_uq UNIQUE (master_order_id, partner_id),
  CONSTRAINT seller_order_id_partner_uq UNIQUE (id, partner_id),
  CONSTRAINT seller_order_subtotal_ck CHECK (subtotal_fils > 0)
);
CREATE INDEX seller_order_partner_idx ON commerce.seller_order (partner_id, created_at DESC);
CREATE TRIGGER seller_order_immutable BEFORE UPDATE ON commerce.seller_order
  FOR EACH ROW EXECUTE FUNCTION platform.forbid_modification();

-- Only what delivery needs, copied at order time. The customer record can be erased without
-- losing the ability to deliver and to settle.
CREATE TABLE commerce.order_delivery (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_order_id uuid NOT NULL REFERENCES commerce.master_order (id),
  customer_id     uuid NOT NULL REFERENCES identity.customer (id),
  recipient_name  text NOT NULL,
  phone_e164      text NOT NULL,
  line1           text NOT NULL,
  line2           text,
  area            text,
  emirate         text NOT NULL,
  lat             numeric(9, 6),
  lng             numeric(9, 6),
  instructions    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_delivery_order_uq UNIQUE (master_order_id),
  CONSTRAINT order_delivery_phone_ck CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);

CREATE TABLE commerce.confirmation_task (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type                  text NOT NULL,
  partner_id                 uuid NOT NULL REFERENCES catalogue.partner (id),
  viewing_stop_id            uuid,
  reservation_id             uuid REFERENCES commerce.reservation (id),
  order_line_id              uuid,
  due_at                     timestamptz NOT NULL,
  channel                    text NOT NULL DEFAULT 'app',
  response                   text,
  responded_by_seller_user_id uuid,
  responded_at               timestamptz,
  escalated_at               timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT confirmation_task_task_type_enum CHECK (task_type IN ('viewing', 'purchase', 'fulfilment')),
  CONSTRAINT confirmation_task_channel_enum CHECK (channel IN ('app', 'whatsapp', 'sms', 'phone')),
  CONSTRAINT confirmation_task_response_enum CHECK (response IN ('Confirmed', 'Declined')),
  CONSTRAINT confirmation_task_stop_fk FOREIGN KEY (viewing_stop_id, partner_id)
    REFERENCES viewing.viewing_stop (id, partner_id),
  CONSTRAINT confirmation_task_responder_fk FOREIGN KEY (responded_by_seller_user_id, partner_id)
    REFERENCES identity.seller_user (id, partner_id),
  CONSTRAINT confirmation_task_subject_ck CHECK (
    num_nonnulls(viewing_stop_id, reservation_id, order_line_id) = 1
    AND ((task_type = 'viewing' AND viewing_stop_id IS NOT NULL)
      OR (task_type = 'purchase' AND reservation_id IS NOT NULL)
      OR (task_type = 'fulfilment' AND order_line_id IS NOT NULL))),
  CONSTRAINT confirmation_task_responded_ck CHECK ((response IS NULL) = (responded_at IS NULL))
);
CREATE INDEX confirmation_task_open_idx ON commerce.confirmation_task (partner_id, due_at) WHERE response IS NULL;
