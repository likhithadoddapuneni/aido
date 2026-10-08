-- A viewing's deposit is credited against at most one order. Crediting is idempotent per viewing
-- (so retrying one order is safe), which would otherwise let a second order claim the same deposit.
CREATE UNIQUE INDEX master_order_one_credit_per_viewing_uq ON commerce.master_order (viewing_request_id)
  WHERE deposit_credit_fils > 0;
