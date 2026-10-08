-- Two lifecycles were enforced by the API alone. Every other lifecycle is also enforced here
-- (ADR-018), so a bug or a hand-written fix cannot, say, activate a partner that was never approved or
-- mark a product Verified without review.
INSERT INTO platform.state_transition (machine, from_state, to_state) VALUES
  ('partner_status', 'Requested', 'Under Review'),
  ('partner_status', 'Under Review', 'Approved/Agreement Pending'),
  ('partner_status', 'Under Review', 'Requested'),
  ('partner_status', 'Approved/Agreement Pending', 'Active'),
  ('partner_status', 'Approved/Agreement Pending', 'Under Review'),
  ('partner_status', 'Active', 'Inactive'),
  ('partner_status', 'Inactive', 'Active'),
  ('data_status', 'Incomplete', 'Ready for Review'),
  ('data_status', 'Ready for Review', 'Verified'),
  ('data_status', 'Ready for Review', 'Incomplete'),
  ('data_status', 'Verified', 'Ready for Review');

CREATE TRIGGER partner_status_machine BEFORE UPDATE OF status ON catalogue.partner
  FOR EACH ROW EXECUTE FUNCTION platform.enforce_state_transition('partner_status', 'status');
CREATE TRIGGER product_data_status_machine BEFORE UPDATE OF data_status ON catalogue.product
  FOR EACH ROW EXECUTE FUNCTION platform.enforce_state_transition('data_status', 'data_status');
