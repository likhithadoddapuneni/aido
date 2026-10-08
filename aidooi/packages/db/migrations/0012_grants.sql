-- Least privilege. aidooi_app is what the API and worker connect as (via a login role that is a
-- member of it); it has DML but no DDL, and cannot rewrite history. aidooi_readonly is for
-- analytics and sees no identity data and no delivery addresses.

GRANT USAGE ON SCHEMA platform, identity, catalogue, recommendation, viewing, commerce,
  fulfilment, settlement, audit TO aidooi_app;
GRANT USAGE ON SCHEMA platform, catalogue, recommendation, viewing, commerce,
  fulfilment, settlement, audit TO aidooi_readonly;

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA platform, identity, catalogue,
  recommendation, viewing, commerce, fulfilment, settlement TO aidooi_app;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA audit TO aidooi_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA catalogue TO aidooi_app;
GRANT EXECUTE ON FUNCTION audit.ensure_partitions(integer) TO aidooi_app;

-- Rows are deleted only where retention or user intent requires it.
GRANT DELETE ON
  platform.job, platform.outbox_event, platform.idempotency_key,
  identity.guest_session, identity.otp_challenge, identity.refresh_token, identity.device_token,
  identity.customer_address,
  catalogue.import_row, catalogue.product_media,
  recommendation.project, recommendation.project_module, recommendation.recommendation_run,
  recommendation.candidate_score, recommendation.composition, recommendation.composition_item,
  recommendation.visualization,
  commerce.reservation_line, commerce.purchase_request_line
TO aidooi_app;

-- Append-only and write-once records: even the application cannot update them.
REVOKE UPDATE ON
  commerce.ledger_entry, commerce.payment_attempt, commerce.master_order, commerce.seller_order,
  viewing.attribution_event, settlement.settlement_line
FROM aidooi_app;

GRANT SELECT ON ALL TABLES IN SCHEMA platform, catalogue, recommendation, viewing, commerce,
  fulfilment, settlement, audit TO aidooi_readonly;
REVOKE SELECT ON commerce.order_delivery, platform.idempotency_key, platform.job FROM aidooi_readonly;

-- Tables added by later migrations inherit the same posture; tighten per table when needed.
ALTER DEFAULT PRIVILEGES IN SCHEMA platform, identity, catalogue, recommendation, viewing,
  commerce, fulfilment, settlement GRANT SELECT, INSERT, UPDATE ON TABLES TO aidooi_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit GRANT SELECT, INSERT ON TABLES TO aidooi_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA catalogue GRANT USAGE, SELECT ON SEQUENCES TO aidooi_app;
