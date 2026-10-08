-- The login the production API and worker connect as. Run once per environment, as the database owner:
--
--   psql "$OWNER_URL" -v api_password="'<from the secret manager>'" -f infra/db/api-role.sql
--
-- It is a member of `aidooi_app` (created by the migrations): DML on the application tables, no DDL, no
-- way to rewrite the audit trail or the ledger, and row-level security applies to it in full. It is
-- NOT the table owner and cannot bypass RLS. Migrations run as the owner, from a separate one-off task.

CREATE ROLE aidooi_api
  LOGIN PASSWORD :api_password
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT
  CONNECTION LIMIT 60;

GRANT aidooi_app TO aidooi_api;

-- Belt and braces: whatever the migrations granted, this login can never create objects.
REVOKE CREATE ON SCHEMA public FROM aidooi_api;
