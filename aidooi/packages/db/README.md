# @aidooi/db

PostgreSQL 16 schema, migration runner, typed query access, durable job queue and the test
harness for AIDOOi. The database enforces the standards that must never be violated (deposit
maths, snapshot immutability, state machines, tenant isolation); the application enforces
everything else.

```bash
docker compose up -d --wait postgres      # from the repo root; port 5433
pnpm --filter @aidooi/db migrate          # apply pending migrations to $DATABASE_ADMIN_URL
pnpm --filter @aidooi/db test             # throwaway database per test file
pnpm --filter @aidooi/db db:codegen       # regenerate src/generated/db.ts after a migration
pnpm --filter @aidooi/db db:check         # CI: fails if the generated types are stale
```

Runtime: Node ≥ 22.18 executes the TypeScript directly (type stripping), so source uses
erasable syntax only (no enums, namespaces or parameter properties) and `.ts` import extensions.

## Modules are schemas

One Postgres schema per bounded context. Application code for a module touches only its own
schema; the two exceptions are **`identity`** and **`catalogue`**, which any module may reference
by ID or foreign key. Everything else crosses a module boundary through that module's service,
never through a join.

| Schema           | Owns                                                                      |
| ---------------- | ------------------------------------------------------------------------- |
| `platform`       | jobs, outbox, idempotency keys, feature flags, state-transition registry  |
| `identity`       | customers, guest sessions, seller/ops users, token families, OTP, consent |
| `catalogue`      | AIP / AID / AIO, partners, locations, imports, compatibility-map versions |
| `recommendation` | projects, runs, candidate scores, compositions, visualizations            |
| `viewing`        | requests, stops, deposit, attribution trail                               |
| `commerce`       | purchase requests, reservations, payments, ledger, master/seller orders   |
| `fulfilment`     | order lines (with locked snapshots), issues                               |
| `settlement`     | monthly runs, settled lines, statements                                   |
| `audit`          | append-only, monthly-partitioned event log                                |

## Conventions

- **IDs.** Catalogue business IDs (`AIP-`/`AID-`/`AIO-` + 8 digits) are primary keys from global
  sequences; they cannot change and rows are never deleted, so they are never reused. Everything
  else uses application-generated UUIDv7.
- **Money** is `bigint` fils (AED × 100), columns end in `_fils`, and `src/client.ts` returns
  them as `number` (throwing if one ever exceeds 2^53). Rates are `numeric(5,4)`. Rounding is
  half-up, done in integers, identically in SQL CHECKs and the domain package.
- **Enums are `text` + a CHECK named `<table>_<column>_enum`.** Each list lives in one place,
  `src/vocab.ts`; `test/schema-conventions.test.ts` fails if the database and that file disagree
  in either direction. Adding a value is a migration plus a one-line edit there.
- **Timestamps** are `timestamptz`. `updated_at` is maintained by trigger.
- **State machines.** Legal edges are rows in `platform.state_transition`; a trigger on each
  guarded table rejects any other change. The same edges are in `vocab.ts` and tested equal.
  The domain package is the first line of defence; this is the last.
- **Write-once and append-only** are enforced by triggers, so they hold for the table owner
  too: order-line snapshots, business IDs, deposit amounts, compatibility-map content, orders,
  ledger entries, attribution events, audit events.
- **Audit** is written with `audit.record(...)` in the same transaction as the change. The
  transaction's `app.correlation_id` is attached automatically.

## Adding a migration

Migrations are forward-only SQL in `migrations/NNNN_name.sql`, numbered contiguously.

1. Create the next file. Never edit one that has been applied anywhere shared: the runner stores
   each file's SHA-256 and refuses to run if it changed.
2. Each file runs in one transaction, so a failure leaves nothing behind. (This means no
   `CREATE INDEX CONCURRENTLY`; build large indexes by hand in a maintenance window, then add a
   migration with `IF NOT EXISTS`.)
3. `pnpm --filter @aidooi/db migrate && pnpm --filter @aidooi/db db:codegen`, commit both.
4. Any enum-style CHECK → add it to `src/vocab.ts`. Any new table with a `partner_id` must have
   forced RLS; any with a `customer_id` must have it or be listed (with a reason) in
   `schema-conventions.test.ts`. Those tests will tell you.

Changes that would break running code ship as **expand → migrate → contract** across separate
releases: add the new shape, backfill and dual-write, then remove the old shape in a later
migration once no deployed version reads it. There are no down migrations; the rollback for a
bad release is the previous application version, which keeps working against the expanded schema.

## Roles and row-level security

Migrations run as the owner. The application connects through a login role that is a member of
`aidooi_app` (DML only; no DDL; cannot update ledger, payment attempts, orders or audit rows).
`aidooi_readonly` is for analytics and sees no identity data and no delivery addresses. Both are
created `NOLOGIN`; grant them to a login role per environment.

Row isolation is by transaction-local settings, set through `withActor` and nothing else:

```ts
import { withActor } from '@aidooi/db';

await withActor(db, { kind: 'seller', partnerId }, (trx) =>
  trx.selectFrom('fulfilment.order_line').selectAll().execute(),
);
```

| `actor.kind` | Sees                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------- |
| `system`     | everything; the only actor that may move stock (`try_reserve`, `consume_reservation`)       |
| `ops`        | everything                                                                                  |
| `seller`     | rows whose `partner_id` is theirs; the delivery copy only for orders they fulfil            |
| `buyer`      | their own rows (by `customerId`); active offers and showroom locations. A guest has no rows |
| _(none)_     | nothing                                                                                     |

RLS is `FORCE`d, so the table owner is subject to it as well. The settings are transaction-local
and cannot leak across pooled connections (tested). **RLS isolates rows, not columns**: which
fields a seller may change on a row they own is the service layer's decision.

Sign-in has to find a user before any partner or customer is known; run that lookup as `system`.

## Eligibility, reservation and jobs

- **`catalogue.eligible_offer`** is the only legitimate source of recommendation candidates:
  Verified + Active product, Active offer, in stock, Active partner.
- **Stock** is decremented only at payment. `commerce.try_reserve` takes a row lock on the offer
  and compares stock with everyone else's live holds; `commerce.consume_reservation` converts
  holds to sold units atomically with the order. A reservation past `expires_at` stops counting
  immediately, before the expiry job runs. Tested with 20 concurrent buyers for 5 units.
- **Jobs** live in `platform.job`; Postgres is the queue. `claim` uses `FOR UPDATE SKIP LOCKED`
  with a lease, retries back off exponentially (5 s … 1 h) and exhausted jobs become `Dead`.
  `enqueue(trx, …)` inside a transaction makes the job atomic with the change that needs it.

## Known limits

- Audit partitions are created by `audit.ensure_partitions(n)`; schedule it monthly. If a month
  is missed, rows land in `audit.event_default` and creating that month's partition later fails
  until they are moved.
- `candidate_score` grows with every run. Archive or drop runs by age; there is no retention
  job yet.
- A buyer's deposit credit may exceed an order smaller than the deposit; the schema stores
  `deposit_credit_fils ≤ gross_fils`, so the domain must decide what happens to the remainder.
