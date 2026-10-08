-- Row-level security. The application sets, per transaction (src/context.ts):
--   app.actor_kind  : 'ops' | 'system' | 'seller' | 'buyer'
--   app.partner_id  : the seller's partner (seller actors)
--   app.customer_id : the buyer (signed-in buyers; absent for guests)
-- With no actor set, nothing is visible. RLS is FORCEd so the table owner is subject to it too.
-- It isolates ROWS. Which COLUMNS a seller may change is the service layer's job.

CREATE FUNCTION platform.actor_is_privileged() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT coalesce(platform.actor_kind() IN ('ops', 'system'), false) $$;

CREATE FUNCTION platform.actor_owns_partner(p_partner uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT platform.actor_kind() = 'seller' AND p_partner IS NOT NULL AND p_partner = platform.actor_partner()
$$;

CREATE FUNCTION platform.actor_owns_customer(p_customer uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT platform.actor_kind() = 'buyer' AND p_customer IS NOT NULL AND p_customer = platform.actor_customer()
$$;

-- catalogue.seller_offer: buyers browse active offers; sellers manage their own.
ALTER TABLE catalogue.seller_offer ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.seller_offer FORCE ROW LEVEL SECURITY;
CREATE POLICY seller_offer_select ON catalogue.seller_offer FOR SELECT USING (
  platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id)
  OR (platform.actor_kind() = 'buyer' AND offer_status = 'Active'));
CREATE POLICY seller_offer_insert ON catalogue.seller_offer FOR INSERT WITH CHECK (
  platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id));
CREATE POLICY seller_offer_update ON catalogue.seller_offer FOR UPDATE
  USING (platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id))
  WITH CHECK (platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id));

-- commerce.seller_order: created by the platform; read by the seller and the buyer it belongs to.
ALTER TABLE commerce.seller_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce.seller_order FORCE ROW LEVEL SECURITY;
CREATE POLICY seller_order_select ON commerce.seller_order FOR SELECT USING (
  platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id)
  OR platform.actor_owns_customer(customer_id));
CREATE POLICY seller_order_insert ON commerce.seller_order FOR INSERT WITH CHECK (platform.actor_is_privileged());

-- fulfilment.order_line: sellers advance their own lines; creation is a platform action.
ALTER TABLE fulfilment.order_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE fulfilment.order_line FORCE ROW LEVEL SECURITY;
CREATE POLICY order_line_select ON fulfilment.order_line FOR SELECT USING (
  platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id)
  OR platform.actor_owns_customer(customer_id));
CREATE POLICY order_line_insert ON fulfilment.order_line FOR INSERT WITH CHECK (platform.actor_is_privileged());
CREATE POLICY order_line_update ON fulfilment.order_line FOR UPDATE
  USING (platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id))
  WITH CHECK (platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id));

-- fulfilment.issue
ALTER TABLE fulfilment.issue ENABLE ROW LEVEL SECURITY;
ALTER TABLE fulfilment.issue FORCE ROW LEVEL SECURITY;
CREATE POLICY issue_select ON fulfilment.issue FOR SELECT USING (
  platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id)
  OR platform.actor_owns_customer(customer_id));
CREATE POLICY issue_insert ON fulfilment.issue FOR INSERT WITH CHECK (
  platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id)
  OR platform.actor_owns_customer(customer_id));
CREATE POLICY issue_update ON fulfilment.issue FOR UPDATE
  USING (platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id))
  WITH CHECK (platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id));

-- viewing.viewing_request: the buyer's own; sellers reach it only through their stops.
ALTER TABLE viewing.viewing_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE viewing.viewing_request FORCE ROW LEVEL SECURITY;
CREATE POLICY viewing_request_select ON viewing.viewing_request FOR SELECT USING (
  platform.actor_is_privileged() OR platform.actor_owns_customer(customer_id));
CREATE POLICY viewing_request_insert ON viewing.viewing_request FOR INSERT WITH CHECK (platform.actor_is_privileged());
CREATE POLICY viewing_request_update ON viewing.viewing_request FOR UPDATE
  USING (platform.actor_is_privileged()) WITH CHECK (platform.actor_is_privileged());

ALTER TABLE viewing.viewing_stop ENABLE ROW LEVEL SECURITY;
ALTER TABLE viewing.viewing_stop FORCE ROW LEVEL SECURITY;
CREATE POLICY viewing_stop_select ON viewing.viewing_stop FOR SELECT USING (
  platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id)
  OR (platform.actor_kind() = 'buyer' AND EXISTS (
        SELECT 1 FROM viewing.viewing_request r
         WHERE r.id = viewing_request_id AND r.customer_id = platform.actor_customer())));
CREATE POLICY viewing_stop_insert ON viewing.viewing_stop FOR INSERT WITH CHECK (platform.actor_is_privileged());
CREATE POLICY viewing_stop_update ON viewing.viewing_stop FOR UPDATE
  USING (platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id))
  WITH CHECK (platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id));

-- commerce.confirmation_task: the seller's work queue.
ALTER TABLE commerce.confirmation_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce.confirmation_task FORCE ROW LEVEL SECURITY;
CREATE POLICY confirmation_task_select ON commerce.confirmation_task FOR SELECT USING (
  platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id));
CREATE POLICY confirmation_task_insert ON commerce.confirmation_task FOR INSERT WITH CHECK (platform.actor_is_privileged());
CREATE POLICY confirmation_task_update ON commerce.confirmation_task FOR UPDATE
  USING (platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id))
  WITH CHECK (platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id));

-- settlement: sellers read their own statements; only the platform writes.
ALTER TABLE settlement.statement ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement.statement FORCE ROW LEVEL SECURITY;
CREATE POLICY statement_select ON settlement.statement FOR SELECT USING (
  platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id));
CREATE POLICY statement_insert ON settlement.statement FOR INSERT WITH CHECK (platform.actor_is_privileged());

ALTER TABLE settlement.settlement_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement.settlement_run FORCE ROW LEVEL SECURITY;
CREATE POLICY settlement_run_select ON settlement.settlement_run FOR SELECT USING (
  platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id));
CREATE POLICY settlement_run_insert ON settlement.settlement_run FOR INSERT WITH CHECK (platform.actor_is_privileged());
CREATE POLICY settlement_run_update ON settlement.settlement_run FOR UPDATE
  USING (platform.actor_is_privileged()) WITH CHECK (platform.actor_is_privileged());

ALTER TABLE settlement.settlement_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement.settlement_line FORCE ROW LEVEL SECURITY;
CREATE POLICY settlement_line_select ON settlement.settlement_line FOR SELECT USING (
  platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id));
CREATE POLICY settlement_line_insert ON settlement.settlement_line FOR INSERT WITH CHECK (platform.actor_is_privileged());

-- Seller-managed reference data: each seller manages their own; buyers may see active locations.
ALTER TABLE catalogue.partner_location ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.partner_location FORCE ROW LEVEL SECURITY;
CREATE POLICY partner_location_select ON catalogue.partner_location FOR SELECT USING (
  platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id)
  OR (platform.actor_kind() = 'buyer' AND status = 'Active'));
CREATE POLICY partner_location_insert ON catalogue.partner_location FOR INSERT WITH CHECK (
  platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id));
CREATE POLICY partner_location_update ON catalogue.partner_location FOR UPDATE
  USING (platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id))
  WITH CHECK (platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id));

-- Sign-in looks a seller user up by email before any partner is known, so that lookup runs as
-- the system actor; everything after sign-in is partner-scoped.
ALTER TABLE identity.seller_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.seller_user FORCE ROW LEVEL SECURITY;
CREATE POLICY seller_user_select ON identity.seller_user FOR SELECT USING (
  platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id));
CREATE POLICY seller_user_insert ON identity.seller_user FOR INSERT WITH CHECK (
  platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id));
CREATE POLICY seller_user_update ON identity.seller_user FOR UPDATE
  USING (platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id))
  WITH CHECK (platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id));

ALTER TABLE catalogue.import_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.import_job FORCE ROW LEVEL SECURITY;
CREATE POLICY import_job_select ON catalogue.import_job FOR SELECT USING (
  platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id));
CREATE POLICY import_job_insert ON catalogue.import_job FOR INSERT WITH CHECK (
  platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id));
CREATE POLICY import_job_update ON catalogue.import_job FOR UPDATE
  USING (platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id))
  WITH CHECK (platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id));

-- Rows follow their job: visible exactly when the parent job is.
ALTER TABLE catalogue.import_row ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue.import_row FORCE ROW LEVEL SECURITY;
CREATE POLICY import_row_all ON catalogue.import_row
  USING (EXISTS (SELECT 1 FROM catalogue.import_job j WHERE j.id = import_job_id))
  WITH CHECK (EXISTS (SELECT 1 FROM catalogue.import_job j WHERE j.id = import_job_id));

ALTER TABLE viewing.viewing_product ENABLE ROW LEVEL SECURITY;
ALTER TABLE viewing.viewing_product FORCE ROW LEVEL SECURITY;
CREATE POLICY viewing_product_select ON viewing.viewing_product FOR SELECT USING (
  platform.actor_is_privileged() OR platform.actor_owns_partner(partner_id)
  OR (platform.actor_kind() = 'buyer' AND EXISTS (
        SELECT 1 FROM viewing.viewing_stop st
          JOIN viewing.viewing_request r ON r.id = st.viewing_request_id
         WHERE st.id = stop_id AND r.customer_id = platform.actor_customer())));
CREATE POLICY viewing_product_insert ON viewing.viewing_product FOR INSERT WITH CHECK (platform.actor_is_privileged());

-- Buyer-owned PII and money: the buyer sees their own, the platform sees all, sellers see none.
ALTER TABLE identity.customer_address ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.customer_address FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_address_all ON identity.customer_address
  USING (platform.actor_is_privileged() OR platform.actor_owns_customer(customer_id))
  WITH CHECK (platform.actor_is_privileged() OR platform.actor_owns_customer(customer_id));

ALTER TABLE identity.consent ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.consent FORCE ROW LEVEL SECURITY;
CREATE POLICY consent_all ON identity.consent
  USING (platform.actor_is_privileged() OR platform.actor_owns_customer(customer_id))
  WITH CHECK (platform.actor_is_privileged() OR platform.actor_owns_customer(customer_id));

ALTER TABLE commerce.master_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce.master_order FORCE ROW LEVEL SECURITY;
CREATE POLICY master_order_select ON commerce.master_order FOR SELECT USING (
  platform.actor_is_privileged() OR platform.actor_owns_customer(customer_id));
CREATE POLICY master_order_insert ON commerce.master_order FOR INSERT WITH CHECK (platform.actor_is_privileged());

ALTER TABLE commerce.payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce.payment FORCE ROW LEVEL SECURITY;
CREATE POLICY payment_select ON commerce.payment FOR SELECT USING (
  platform.actor_is_privileged() OR platform.actor_owns_customer(customer_id));
CREATE POLICY payment_insert ON commerce.payment FOR INSERT WITH CHECK (platform.actor_is_privileged());
CREATE POLICY payment_update ON commerce.payment FOR UPDATE
  USING (platform.actor_is_privileged()) WITH CHECK (platform.actor_is_privileged());

-- The delivery copy is the one place a seller may see buyer PII: only for orders they fulfil.
ALTER TABLE commerce.order_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE commerce.order_delivery FORCE ROW LEVEL SECURITY;
CREATE POLICY order_delivery_select ON commerce.order_delivery FOR SELECT USING (
  platform.actor_is_privileged() OR platform.actor_owns_customer(customer_id)
  OR (platform.actor_kind() = 'seller' AND EXISTS (
        SELECT 1 FROM commerce.seller_order so
         WHERE so.master_order_id = order_delivery.master_order_id
           AND so.partner_id = platform.actor_partner())));
CREATE POLICY order_delivery_insert ON commerce.order_delivery FOR INSERT WITH CHECK (platform.actor_is_privileged());

-- Analytics role: read-only across non-PII tables, bypassing actor scoping by explicit policy.
CREATE POLICY readonly_select ON catalogue.seller_offer FOR SELECT TO aidooi_readonly USING (true);
CREATE POLICY readonly_select ON commerce.seller_order FOR SELECT TO aidooi_readonly USING (true);
CREATE POLICY readonly_select ON fulfilment.order_line FOR SELECT TO aidooi_readonly USING (true);
CREATE POLICY readonly_select ON fulfilment.issue FOR SELECT TO aidooi_readonly USING (true);
CREATE POLICY readonly_select ON viewing.viewing_request FOR SELECT TO aidooi_readonly USING (true);
CREATE POLICY readonly_select ON viewing.viewing_stop FOR SELECT TO aidooi_readonly USING (true);
CREATE POLICY readonly_select ON commerce.confirmation_task FOR SELECT TO aidooi_readonly USING (true);
CREATE POLICY readonly_select ON settlement.statement FOR SELECT TO aidooi_readonly USING (true);
CREATE POLICY readonly_select ON settlement.settlement_run FOR SELECT TO aidooi_readonly USING (true);
CREATE POLICY readonly_select ON settlement.settlement_line FOR SELECT TO aidooi_readonly USING (true);
CREATE POLICY readonly_select ON commerce.master_order FOR SELECT TO aidooi_readonly USING (true);
CREATE POLICY readonly_select ON commerce.payment FOR SELECT TO aidooi_readonly USING (true);
CREATE POLICY readonly_select ON catalogue.partner_location FOR SELECT TO aidooi_readonly USING (true);
CREATE POLICY readonly_select ON catalogue.import_job FOR SELECT TO aidooi_readonly USING (true);
CREATE POLICY readonly_select ON catalogue.import_row FOR SELECT TO aidooi_readonly USING (true);
CREATE POLICY readonly_select ON viewing.viewing_product FOR SELECT TO aidooi_readonly USING (true);
