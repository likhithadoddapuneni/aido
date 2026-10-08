-- Seller-managed catalogue: who submitted a product, offer versioning, a stock guard, import outcomes.

-- A seller may edit only products their own partner submitted; products loaded by AIDOOi ops have none.
ALTER TABLE catalogue.product
  ADD COLUMN submitted_by_partner_id uuid REFERENCES catalogue.partner (id);
CREATE INDEX product_submitted_by_idx ON catalogue.product (submitted_by_partner_id)
  WHERE submitted_by_partner_id IS NOT NULL;

-- Optimistic concurrency for offer edits: every update bumps the version, and the API updates
-- only where the version the client read is still current.
ALTER TABLE catalogue.seller_offer ADD COLUMN version integer NOT NULL DEFAULT 1;

CREATE FUNCTION catalogue.bump_offer_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END
$$;
CREATE TRIGGER seller_offer_version BEFORE UPDATE ON catalogue.seller_offer
  FOR EACH ROW EXECUTE FUNCTION catalogue.bump_offer_version();

-- Stock held by a live reservation cannot be taken away by a seller or an operator. Only the platform
-- (checkout spending a reservation) may lower stock beneath what is reserved — and it never does,
-- because consume_reservation lowers stock by exactly the reserved quantity as it converts it.
CREATE FUNCTION catalogue.assert_stock_covers_reservations() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_reserved integer;
BEGIN
  IF platform.actor_kind() = 'system' THEN
    RETURN NEW;
  END IF;
  SELECT coalesce(sum(rl.quantity), 0) INTO v_reserved
    FROM commerce.reservation_line rl
    JOIN commerce.reservation r ON r.id = rl.reservation_id
   WHERE rl.offer_id = NEW.id AND r.state = 'Active' AND r.expires_at > now();
  IF NEW.stock_qty < v_reserved THEN
    RAISE EXCEPTION 'stock % is below the % units held by live reservations on offer %',
      NEW.stock_qty, v_reserved, NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER seller_offer_stock_guard BEFORE UPDATE OF stock_qty ON catalogue.seller_offer
  FOR EACH ROW WHEN (NEW.stock_qty < OLD.stock_qty)
  EXECUTE FUNCTION catalogue.assert_stock_covers_reservations();

-- What a committed import did, so re-reading a finished job never has to guess. Counts accumulate chunk
-- by chunk while the job is still being applied.
ALTER TABLE catalogue.import_job
  ADD COLUMN created_count integer,
  ADD COLUMN updated_count integer,
  ADD COLUMN committed_at timestamptz,
  ADD CONSTRAINT import_job_commit_ck CHECK (state <> 'Imported' OR committed_at IS NOT NULL);
