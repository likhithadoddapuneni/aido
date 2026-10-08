-- At most one live payment may exist for an order checkout. Without this, two simultaneous payment
-- attempts (a double-tap, a retry with a new key, a second device) could each be authorised and each
-- be captured, charging the buyer twice for one order. The application also checks, but a race
-- between two requests can only be closed by the database.
CREATE UNIQUE INDEX payment_one_live_order_uq ON commerce.payment (purchase_request_id)
  WHERE purpose = 'Order' AND state IN ('Pending', 'Authorized', 'Successful');
