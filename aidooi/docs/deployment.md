# Deployment

What ships, how it is configured, and the order things happen in. Read the last section first if you want
to know what has and has not been verified.

## What ships

One container image (`infra/docker/api.Dockerfile`), three commands:

| Command                       | Role              | Notes                                                                                                                                                                                 |
| ----------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node dist/main.js` (default) | HTTP API          | Stateless; scale horizontally. `GET /health/live` (never touches a dependency) and `GET /health/ready` (checks the database)                                                          |
| `node dist/worker.js`         | Background jobs   | Postgres is the queue (`FOR UPDATE SKIP LOCKED`), so run ≥ 2 for availability; they never double-run a job. Serves its own `/health/live` that goes unhealthy if its poll loop stalls |
| `node dist/migrate.js`        | Schema migrations | One-off task; exits when done. Forward-only, checksum-verified, advisory-locked                                                                                                       |

Plus PostgreSQL 16 (managed, Multi-AZ, point-in-time recovery) and object storage + CDN for media.

## Two database logins

| Login                                      | Used by               | Can                                                                                                                                    |
| ------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**                                  | The migrate task only | Create and alter schema                                                                                                                |
| **`aidooi_api`** (`infra/db/api-role.sql`) | API and worker        | DML on application tables. No DDL, cannot rewrite the audit trail or ledger, cannot bypass row-level security, cannot become the owner |

`packages/db/test/production-role.test.ts` connects as that role and tries to break out; it must stay green.

## Configuration

Validated at start-up (`apps/api/src/config.ts`): a bad configuration stops the process rather than
limping. Secrets come from the secret manager, never the image or the repo.

| Key                                                                                                                              | Required in prod  | Purpose                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                                                   | yes               | `aidooi_api` connection string                                                                                                                             |
| `DATABASE_ADMIN_URL`                                                                                                             | migrate task only | Owner connection                                                                                                                                           |
| `JWT_PRIVATE_KEY_PEM`                                                                                                            | yes               | Ed25519 key that signs access tokens (rotate by adding a new `JWT_KEY_ID`)                                                                                 |
| `AUTH_SECRET`                                                                                                                    | yes (≥ 32 chars)  | Root secret for token/OTP hashing                                                                                                                          |
| `VIEWING_PASS_SECRET`                                                                                                            | yes (≥ 32 chars)  | Signs viewing QR passes                                                                                                                                    |
| `PAYMENT_WEBHOOK_SECRET`                                                                                                         | yes               | Verifies provider webhooks                                                                                                                                 |
| `PAYMENT_GATEWAY`, `ALLOW_MOCK_PAYMENTS`                                                                                         | see below         | **Production refuses to start on the mock gateway** unless `ALLOW_MOCK_PAYMENTS=true`, which is for a staging environment with no real stock or money only |
| `CORS_ORIGINS`                                                                                                                   | yes               | Comma-separated exact origins; `*` is refused                                                                                                              |
| `MIN_APP_VERSION`                                                                                                                | no                | Builds below it get 426                                                                                                                                    |
| `RATE_LIMIT_MONEY_PER_MIN`                                                                                                       | no (20)           | Ceiling on checkout/pay per client per minute                                                                                                              |
| `MEDIA_BASE_URL`, `IMPORT_MAX_ROWS`, `JWT_ISSUER`, `JWT_AUDIENCE`, `APPLE_CLIENT_ID`, `GOOGLE_CLIENT_ID`, `LOG_LEVEL`, `RELEASE` | no                | See `config.ts`                                                                                                                                            |

## Rollout order

1. **Build** the image; CI has already run format, lint, typecheck, every test (including the
   differential test against the reference engine), and the drift checks (DB types, OpenAPI, client types,
   design tokens).
2. **Migrate** — run the migrate task. Migrations are **expand → migrate → contract**: a release only ever
   ships additive schema changes the _previous_ code tolerates; the destructive "contract" step ships one
   release later. Never edit an applied migration (its checksum is verified).
3. **Deploy** API and worker (blue/green or rolling). Readiness gates traffic; the worker's recurring jobs
   (`ensureRecurring`) re-seed themselves on start, so a restore or deploy never leaves housekeeping dead.
4. **Approve the compatibility maps** (once per map version). Until an ops admin approves the version
   shipped in the code (`POST /v1/ops/compat-maps/:kind/approve`), the recommendation engine refuses to
   run — by design. This is the merchandising sign-off gate.
5. **Smoke**: `GET /health/ready`, create a guest session, create a project, request a recommendation.

## Operations

- **Idle database connections** can be terminated by a failover; the pool logs and reconnects (tested).
- **A crashed payment** is re-driven by `commerce.resume_payments` (every payment step is idempotent at the
  provider and in our tables). **Money never moves without a ledger entry** (balanced by constraint).
- **Stuck jobs** show as `platform.job` rows in `Failed`/`Dead`; `Dead` is retained for inspection.
- **Audit** (`audit.event`) is append-only and partitioned monthly; `platform.ensure_audit_partitions`
  keeps the next three months created.
- **Backups**: PITR on the managed database (RPO ≈ 5 min); rehearse restores quarterly.
- **Observability**: JSON logs with `x-correlation-id` on every line and error response; dashboards on
  checkout success rate, seller confirmation latency, payments stuck Authorized > 5 min, job lag.

## Verified vs not verified — read this

**Verified, by running it:** the image builds; the container starts; migrations apply from the bundled
artefact; `/health/live`, `/health/ready` and real requests work against Postgres; the worker reports its
own health; the least-privilege database role holds up under attack; production refuses unsafe
configuration (mock payments, missing secrets, wildcard CORS).

**Not verified, and why:**

- **Infrastructure-as-code.** There is no Terraform/OpenTofu or cloud CLI in the build environment, so
  none was written: unverifiable IaC is worse than none. The target is AWS `me-central-1` (confirm each
  managed service is available there; Azure UAE North is the fallback, since nothing here is AWS-specific):
  ECS Fargate for API and worker, RDS PostgreSQL 16 Multi-AZ, S3 + CloudFront, Secrets Manager, an ALB with
  a WAF, and a one-off ECS task for the migrator. The checklists above are what it must create.
- **A real payment provider.** The mock gateway implements the full contract and is exercised by a
  published contract suite (`apps/api/test/gateway.contract.ts`); that same suite must pass against the
  provider's sandbox before any real-money launch.
- **Apple/Google sign-in against live key sets**, **WhatsApp/SMS/push delivery**, and **object storage**
  are behind ports with fakes; the real adapters are untested here.
- **Load.** Concurrency correctness is tested (12 buyers racing for 3 units; simultaneous payments;
  concurrent job workers). Throughput under production load has not been measured; run k6 against staging.

## Known limitations and follow-ups

These are real, understood, and deliberately not hidden:

- **`AUTH_SECRET` is not yet rotatable.** Everything secret-derived (the keyed hashes of phones and OTP
  codes, and the encryption of staff authenticator seeds) comes from this one root. Changing it would
  invalidate pending OTPs (harmless) **and make every staff TOTP seed undecryptable** (everyone must
  re-enrol). Key versioning — a `kid` prefix on stored ciphertext, with the old key kept for decryption —
  is the follow-up; until then treat the secret as permanent and back it up like a database key.
- **An access token outlives an MFA reset by up to 15 minutes** (refresh tokens are revoked at once).
- **Refresh-token reuse is strict**: a client that loses the response to a refresh and retries with the
  old token is signed out. Safe by design (reuse is treated as theft); it costs a re-login on flaky links.
- **Partial refunds are refused** (`partial_refund_unsupported`): settlement and clawback cannot yet
  represent them. Full-line refunds work.
- **Product merge** (duplicate AIDs) is not built: an offer's `product_id` is immutable by trigger, so a
  merge needs a deliberate schema change.
- **Seller catalogue import is CSV only.** XLSX was rejected: the only maintained parsers are heavy and
  carry zip-bomb exposure. Excel opens and saves CSV.
- **A deposit that covers an entire order** is placed without a card charge; the tiny excess goes back to
  the deposit card via a job. Both paths are tested.
