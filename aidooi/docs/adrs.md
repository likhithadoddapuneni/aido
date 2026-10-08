# Architecture decision records

Status of this file: **decided**. Each record states the decision, why, what was rejected, and what
would make us revisit it. Where a decision departs from an earlier proposal in
`../../docs/07-production-architecture.md`, the record says so and this file wins.

Contents: [A. Product & standards](#a-product--standards) ·
[B. Platform & stack](#b-platform--stack) · [C. Data](#c-data) · [D. Commerce & money](#d-commerce--money) ·
[E. Security & identity](#e-security--identity) · [F. Delivery & operations](#f-delivery--operations) ·
[G. Gaps in the standards](#g-gaps-in-the-standards-closed) · [H. What is deliberately deferred](#h-deliberately-deferred)

---

## A. Product & standards

### ADR-001 — Three surfaces, one backend

Buyer app (iOS, Android, web from one Expo codebase), Seller app (Expo, iOS/Android), Seller portal and
Ops console (two separate web SPAs). One API.
**Why separate apps:** different users, devices and blast radius. A defect in the ops console must not
be able to ship in the buyer binary, and seller staff must not be able to reach ops screens by URL.
**Rejected:** one app with role switching (shared bundle exposes ops code paths to every user).

### ADR-002 — Sellers are first-class users (supersedes AID-LOG-013 "no seller portal in MVP")

Sellers submit products and manage their own offers (price, stock, delivery, viewing status), confirm
viewings and purchases, check buyers in by QR, advance fulfilment, answer issues and read statements.
**Hard limits:** sellers cannot set or see `commission_rate`; cannot mark anything `Verified`; cannot see
other sellers' offers; see buyer PII only as far as a confirmed order or viewing needs. Partner
**activation, commission and verification remain manual ops gates** exactly as LOG-013 intends.
**Action:** revise AID-LOG-013 and Master Plan §7 so the standard matches the product.

### ADR-003 — Invite-only seller onboarding at launch

Ops creates the partner and sends the owner an invite; no self-registration. The partner status machine
(`Requested → Under Review → Approved/Agreement Pending → Active`) is unchanged. Self-registration is a
post-launch decision once the verification queue's throughput is measured.

### ADR-004 — Catalogue input: spreadsheet template and portal editing

Sellers upload a CSV/XLSX template or edit in the portal. Rows validate against AID-DATA-001…014 with
row-level errors. Feed/API integration is deferred until a partner asks and ops can support it.
New or changed product data enters `Ready for Review`; **only ops can set `Verified`**; any seller edit to
a `Verified` product returns it to `Ready for Review` (enforced by the `data_status` machine, so a seller
can never silently alter a verified record). Offer edits (price, stock) take effect immediately and never
alter an open reservation or a locked order snapshot.

### ADR-005 — Arabic and RTL at launch

All user-facing strings go through i18n from the first screen; layouts use logical (start/end)
properties; the design system is RTL-tested. English and Arabic ship together. Retrofitting RTL is
far more expensive than building it in.

### ADR-006 — Native apps plus web, not PWA-only

Native iOS/Android for push reliability, QR/camera, wallet payments and store presence; the same Expo
codebase exports the buyer web app. **Rejected:** PWA-only (weaker iOS push, no wallet-grade payment UX).

### ADR-007 — AID-VIS-001 is out of MVP scope

LOG-011 Concept visualization (measured plan from verified dimensions, labelled `Concept`) is the launch
visualization. Photographic rendering is a later product decision, not a launch dependency.

### ADR-008 — Partner-delivered logistics for MVP

Sellers deliver, as the standards assume. AIDOOi records status, owns the buyer relationship and
settles after confirmed receipt. Each partner record carries `after_sales_terms`, shown to the buyer
before purchase (no universal return period, by design).

---

## B. Platform & stack

### ADR-009 — Modular monolith on Fastify (revises the NestJS proposal)

One deployable (API + worker from one image). Modules are plain TypeScript with an explicit public
interface; cross-module access goes through that interface, enforced by a dependency lint rule.
**Why not NestJS 12 (the earlier proposal):** it is a new major version we could not verify against our
toolchain (native ESM, Node type stripping, Vitest), and its decorator/DI machinery buys nothing here that
explicit functions and plugins do not. Fastify 5 gives schema-first validation, speed and a mature plugin
model with less indirection.
**Revisit if:** the team grows past ~10 backend engineers and wants framework-enforced boundaries.

### ADR-010 — TypeScript 6.0 pinned, run directly by Node

TypeScript is pinned to 6.0.x because `typescript-eslint` supports `<6.1`; TS 7 (the native compiler)
is adopted when the lint toolchain supports it. Source is **erasable-syntax-only** (no enums, namespaces or
parameter properties) with explicit `.ts` import extensions, so Node ≥ 22.18 runs it directly: no build
step in development or tests. Production images are bundled with esbuild.
Workspace packages are consumed as source ("just-in-time packages").

### ADR-011 — pnpm workspaces, no Turborepo yet

Four to six packages do not need a task graph. `pnpm -r` is enough; Turborepo is added when CI time
justifies caching.

### ADR-012 — PostgreSQL is the queue; no Redis at launch (revises the proposal)

Durable jobs (`platform.job`) are claimed with `FOR UPDATE SKIP LOCKED`; the transactional outbox relays
events. At launch volume this removes a stateful dependency and gives exactly-once enqueue inside the
business transaction (a job exists iff the state change committed). Rate limiting uses in-process limits
per instance plus WAF rules at the edge. Redis is added only when a measured need appears.

### ADR-013 — REST + OpenAPI + SSE

Contract-first: Zod schemas in `packages/contracts` generate the OpenAPI document and the typed client for
all front ends. SSE streams order/confirmation status. **Rejected:** GraphQL (no client-shaped-query
problem here), WebSockets (more infrastructure than SSE needs).
Versioned under `/v1`, additive changes only, plus a **minimum-supported-app-version** gate because old
binaries live for months.

### ADR-014 — Web clients

Buyer web is the Expo web export (one codebase with iOS/Android). Seller portal and Ops console are Vite +
React SPAs behind authentication (no SEO need; lighter than Next.js). A static marketing site is separate
and out of scope.

### ADR-015 — Hosting: AWS, UAE region

Primary `me-central-1` (UAE) for latency and PDPL posture; ECS Fargate, RDS PostgreSQL 16 Multi-AZ, S3,
CloudFront, Secrets Manager. **Verify per-service regional availability before provisioning** (some
managed services lag in newer regions); fallback is Azure UAE North with the same container image,
because nothing in the application depends on an AWS-only service.

---

## C. Data

### ADR-016 — Money is integer fils

`bigint` columns suffixed `_fils`; `Fils` branded type in code; no float ever carries money. Rates are
basis points. Rounding is half-up, **once per line, at snapshot time**, and the result is persisted;
settlement sums persisted values and never re-derives them.

### ADR-017 — One Postgres schema per module

`platform, identity, catalogue, recommendation, viewing, commerce, fulfilment, settlement, audit`.
References to `identity` and `catalogue` ids are allowed everywhere; other cross-module joins are not
(application code goes through the owning module).

### ADR-018 — State machines are data, enforced twice

Each lifecycle is a table of allowed transitions in `packages/domain` **and** rows in
`platform.state_transition` that `BEFORE UPDATE` triggers check. A test asserts the two are identical, so
neither a bug in the app nor a hand-written SQL fix can produce an illegal state.

### ADR-019 — Enums are `text` + CHECK

Adding a value to a CHECK is a transactional migration; adding to a PG enum is awkward and
non-transactional in places. A drift test keeps CHECK lists equal to `packages/domain` vocabularies.

### ADR-020 — Identifiers

Business ids (`AIP-/AID-/AIO-########`) are PKs of catalogue tables, from global sequences, never reused,
never updated, rows never deleted (deactivate instead). All other entities use UUIDv7 generated in the
application (time-ordered, index-friendly).

### ADR-021 — Audit is append-only and written in the same transaction

`audit.event` is partitioned monthly; UPDATE/DELETE/TRUNCATE are revoked and trigger-blocked. A state
change and its audit row commit together or not at all. Ops reads of buyer PII are audited too.

### ADR-022 — Write-once snapshots

`order_line` price/quantity/commission columns and the JSON snapshot reject UPDATE by trigger. Anything
that can change later (refund, adjustment) is a new ledger row, never an edit.

### ADR-023 — Row-level security isolates sellers

RLS is ENABLED and FORCED on seller-scoped tables; the API connects as a non-owner role without
`BYPASSRLS` and sets `app.actor_kind / app.partner_id / app.customer_id` per transaction. A seller query
bug cannot leak another seller's rows because the database refuses.

### ADR-024 — Eligibility lives in a view

`catalogue.eligible_offer` is the only path by which recommendation reads offers. The engine re-checks
eligibility anyway (defence in depth against a wrong adapter).

### ADR-025 — Retention and PII

PII lives only in `identity`; orders copy just the delivery fields they need. Consent is recorded per
purpose with policy version. Deletion requests anonymise `identity` rows while preserving order and
settlement records required for tax and audit (retention schedule maintained with counsel).

---

## D. Commerce & money

### ADR-026 — AIDOOi is merchant of record

One payment to AIDOOi per checkout; monthly settlement to sellers (LOG-014, WF-08). No marketplace split
payments at capture (payout licensing and refund complexity, not required by the standards).

### ADR-027 — Authorise → validate → capture, behind a `PaymentGateway` port

The saga: validate every line against live offers → (explicit seller confirmation only where required) →
authorise → re-check validity and stock under row locks → capture → one DB transaction locks snapshots,
splits the order, decrements stock and writes the ledger. Any failure after authorisation **voids** it.
A `MockGateway` with a published contract suite is the only implementation until a provider is chosen;
the contract suite is re-run against the provider sandbox before any real-money launch.

### ADR-028 — Seller confirmation: automatic by default, explicit where data is uncertain

Offers are the seller's own declared truth, so checkout validates price and stock against the live offer
automatically. An explicit seller confirmation task is created when the offer is `Low Stock` or its
availability has not been confirmed within 24 h. SLAs: purchase confirmation **4 h**, viewing confirmation
**12 h**; escalate to an ops phone call at 50% of the SLA; unconfirmed tasks lapse and the line returns to
`Rebuild Required`. The 24-hour purchase window starts at the **last** confirmation, so a slow seller
never shortens the buyer's time.

### ADR-029 — Stock safety

`stock_qty` is decremented only on payment success. Active reservations are counted against availability
(`stock − reserved by others ≥ qty`) under `SELECT … FOR UPDATE` on the offer row. A concurrency test
(20 buyers, 5 units) proves no oversell.

### ADR-030 — Deposit rules, completed

5% of the selected products' Current Selling Price, capped at **AED 500 per viewing request** (decision D8).
Completed viewing → deposit held **7 days**; a purchase in the window credits it in full, otherwise it is
refunded in full automatically (or earlier on the buyer's request). No-show → non-refundable.
Cancelled by buyer or any seller → full refund. All movements are ledger entries.

### ADR-031 — Refund routing

A buyer may have paid with two instruments (the order capture and an earlier deposit). Refunds go to the
capture first up to what was captured, then to the deposit payment, never more than was paid on either,
and always reconcile exactly. `planRefund` is a pure, property-tested function.

### ADR-032 — Settlement is a ledger computation (fixes a prototype defect)

`net = Σ(gross − commission) on eligible lines − Σ(gross − commission) clawed back`. A refund before
settlement never made the line eligible, so there is nothing to subtract; a line already paid and refunded
since is clawed back exactly once. The prototype subtracted adjustments for refunds it never counted,
understating partner payouts; the production rule is covered by a regression test and a property test.

### ADR-033 — Viewing confirmation freshness

A seller's viewing confirmation is reusable for **72 h**; older ones must be reconfirmed (LOG-012 §4).

### ADR-034 — Premium tier comes from price (the one deliberate engine change)

The prototype ranked the Premium option by a fixed per-family tier; the production record carries no
tier, and AID-DATA-010 says price decides tier. Production derives tier from the offer's Current
Selling Price. The differential test applies this single change to the prototype and then requires
**every** other selection, score and total to match exactly — so any other divergence fails the build.

### ADR-043 — Checkout invariants live in the database as well as the saga

Found by tests that tried to break the saga, then fixed at the database so no future code path can
reintroduce them:

- **One live payment per checkout** — a unique partial index on `commerce.payment`. Two simultaneous
  attempts (a double-tap, a retry with a new key, a second device) could each be authorised and each
  captured. Now the second is refused (`payment_in_progress`); an attempt stuck in 3-D Secure for over a
  minute may be replaced by a new one.
- **A deposit credits exactly one order** — a unique partial index on `master_order(viewing_request_id)`.
  The viewing module's credit is repeatable _per viewing_ by design (retrying one order must not change
  its answer), which let a second order claim the same deposit.
- **Stock held by a live reservation cannot be lowered** by a seller or an operator (trigger); only the
  platform spends it, at order placement.
- **No capture before validation, no order without a successful payment, refunds ≤ payment, balanced
  ledger groups** — constraints/triggers, each with a test that attacks it directly.

### ADR-044 — Lock order in checkout

A checkout takes the exclusive lock on every offer row **first, in id order**, before inserting any row
that references the offer. Taking it after (when the foreign-key insert already holds a shared lock) let
two buyers each hold a shared lock and wait for the exclusive one: a deadlock that only appeared under
load. The 12-buyers-for-3-units test caught it; it is now a gate.

### ADR-045 — Saga failure semantics

Every provider call is idempotent and keyed by the payment id, and every call is recorded append-only.

- **Authorisation succeeds, then anything changes** (price, stock, window): the authorisation is voided;
  nothing is captured.
- **Capture fails:** the payment is Failed and the hold is released at the provider.
- **Capture succeeds, order placement fails** (a platform fault — sellers cannot reduce reserved stock):
  the buyer is refunded in full automatically and the checkout returns to Rebuild Required. No ledger
  entries are posted for money the order never booked.
- **The provider times out _after_ acting:** the client retries with the same key; the provider replays
  its original answer, so the buyer is never charged twice. A recovery job re-drives any payment left
  Authorized past two minutes, so a crashed process never strands money.
- **A losing concurrent attempt** releases its own authorisation.

### ADR-046 — Notifications are delivered from a transactional outbox

Events (`order.placed`) are written in the same transaction as the order and relayed by a worker job,
at-least-once, with a dedupe key on every notification. Nothing is sent from inside a business
transaction and nothing is lost if the process dies right after commit.

### ADR-048 — The design system is data, and accessibility is a test

`packages/ui-tokens` holds AID-DATA-015 as typed values consumed directly by React Native and as generated
CSS variables on web. A test computes WCAG contrast for every foreground/background pairing the UI uses.
It found that the standard's secondary text grey (`#6B7280`) is 4.11:1 on its own card surface — under
AA. We added one documented token, `text2OnSurface` (`#636B78`, 4.57:1), for text on cards and left every
other value exactly as published. Beige and the placeholder grey are asserted to be decorative-only.

### ADR-047 — Money-moving endpoints have their own rate ceiling

Checkout and payment are limited to a small, configurable number of requests per client per minute
(default 20), far below the global limit; a retry storm there is a bug or an attack.

---

## E. Security & identity

### ADR-035 — Authentication

- **Buyers:** phone OTP (SMS, WhatsApp fallback), Sign in with Apple, Google. Guest sessions use an
  opaque token and upgrade in place at the first viewing or purchase, resuming the pending action
  (gap #13); guest data merges into the registered customer.
- **Sellers and ops:** email + password (argon2id) + **mandatory TOTP 2FA**, invite-only.
- **Tokens:** 15-minute JWT access (EdDSA) + opaque rotating refresh token with **reuse detection**
  (a replayed refresh revokes the whole family). Mobile stores tokens in the OS keychain/keystore.
- OTP: 6 digits, 5 min, 5 attempts, per-phone and per-IP throttles, no user enumeration.

### ADR-036 — Authorisation

Policy functions per action plus RLS (ADR-023). Roles: `buyer`; `seller_owner / seller_manager /
seller_staff` scoped to a partner (and optionally one location); `ops_admin / ops_catalogue /
ops_support / ops_finance`. Finance is the only role that can approve a settlement run.

### ADR-037 — Payments security

No PAN ever touches AIDOOi (provider SDK/hosted fields; PCI SAQ-A). Webhooks are signature-verified
and de-duplicated by provider event id; every mutating call is idempotent.

### ADR-038 — Mobile hardening

Certificate pinning with a rotation plan, secure storage for tokens, no PII in push payloads,
jailbreak/root signals logged not blocked, screenshots blocked on payment screens.

---

## F. Delivery & operations

### ADR-039 — Environments and delivery

`dev` (ephemeral per PR), `staging` (prod-shaped, provider sandbox), `prod`. Backend: blue/green on ECS;
migrations are forward-only and backward-compatible (**expand → migrate → contract**). Mobile: EAS Build
and Submit, OTA updates for JS-only fixes, staged rollout 5% → 25% → 100%.

### ADR-040 — Observability

OpenTelemetry traces and metrics, structured JSON logs with a correlation id propagated from the apps,
Sentry for API and both mobile apps. **No PII in telemetry.** Dashboards: checkout success, seller
confirmation latency, payment/capture mismatches, job lag. SLOs: API 99.9%, checkout success ≥ 97% of
valid attempts, confirmation task delivery < 60 s, RPO 5 min, RTO 1 h.

### ADR-041 — Test pyramid is part of the architecture

Unit + property tests in `domain`; **differential test against the reviewed prototype**; real-Postgres
integration tests for every constraint, trigger, RLS policy and concurrency claim; a gateway contract
suite; Maestro E2E on real devices; k6 load tests before launch. The ten Master Plan acceptance gates
each map to named tests.

### ADR-042 — Search, media, analytics

Postgres full-text + trigram (catalogue is thousands, not millions, of rows). S3 + CloudFront with image
variants generated in the worker (AVIF/WebP). Product analytics without PII via PostHog (EU cloud).

---

## G. Gaps in the standards, closed

Numbering follows `../../docs/05-gaps-and-decisions.md`.

| #   | Gap                                                | Decision                                                                                                                                                                                                                                                                                                                                                              |
| --- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | No villa budget table                              | Sum of the villa's own room modules at the chosen tier (LOG-008's stated principle). Implemented and tested                                                                                                                                                                                                                                                           |
| 2   | AID-VIS-001 missing                                | Out of MVP (ADR-007)                                                                                                                                                                                                                                                                                                                                                  |
| 3   | LOG-001 §1 refers to a non-existent LOG-003 budget | Drafting error; budgets come from LOG-006/007/008. Correct the source                                                                                                                                                                                                                                                                                                 |
| 4   | No craftsmanship factor in Match Score             | Not added. The LOG-008 §6 upgrade pass raises quality when budget exceeds need; headroom is surfaced to the buyer, not spent for its own sake                                                                                                                                                                                                                         |
| 5   | Style/colour maps not supplied                     | Versioned first draft (`2026.1-draft`) ships in `packages/domain`; **a release checklist item requires AIDOOi merchandising sign-off before launch**; the version is stamped on every run                                                                                                                                                                             |
| 6   | "Available Placement Space" undefined              | Longest wall run × 80% (anchor) / 92% (others); floor-plan parsing improves it later without changing the interface                                                                                                                                                                                                                                                   |
| 7   | Decor zones are qualitative                        | Decor count from the size profile; zone counting arrives with floor-plan input                                                                                                                                                                                                                                                                                        |
| 8   | "Meaningful" Premium upgrade                       | Score +1 or total +5% over Best Overall, else Premium is withheld                                                                                                                                                                                                                                                                                                     |
| 9   | Price staleness                                    | Validate at checkout; a changed price needs buyer approval; snapshot locks at payment success                                                                                                                                                                                                                                                                         |
| 10  | Per-partner returns                                | `after_sales_terms` on the partner, shown before purchase                                                                                                                                                                                                                                                                                                             |
| 11  | Dining capacity vs priced branch                   | Round **up** to the next priced table; chair quantity stays the exact capacity                                                                                                                                                                                                                                                                                        |
| 12  | Bedroom consistency                                | When on, the master bedroom is independent and every later bedroom prefers the same parent product family (AIP), per product type, as the first guest bedroom: +5 on the _selection_ pick score only, never on Match Score or budget. Implemented (`bedroomConsistency` on apartment and villa projects; bedroom sizes and bed sizes are inputs too, per AID-SPC-007) |
| 13  | Guest → registered                                 | ADR-035                                                                                                                                                                                                                                                                                                                                                               |
| 14  | Telephone fulfilment capture                       | Superseded by the seller app; an ops screen with who/when audit remains as the fallback                                                                                                                                                                                                                                                                               |

| Open question (docs/05) | Decision                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| 1 AID-VIS-001 in scope? | No                                                                                            |
| 2 Who owns the maps?    | AIDOOi merchandising lead; versioned; reviewed quarterly and on any catalogue taxonomy change |
| 3 Villa rule            | Module sum                                                                                    |
| 4 Quality factor        | No                                                                                            |
| 5 Bedroom consistency   | As gap 12                                                                                     |
| 6 After-sales terms     | Per partner, ADR-008                                                                          |
| 7 Deposit cap scope     | Per viewing request                                                                           |

**Interpretation calls** A–F from `docs/05` are implemented as written there and live in
`packages/domain/src/standards/constants.ts`, each with its source clause.

**Desk pricing:** LOG-001 has no Desk row; Desk uses the console/storage market band
(`Desk: 200–500 / 500–900 / 900–1,600 / 1,600–3,000 / 3,000–6,000 AED`) until AIDOOi publishes one.

---

## H. Deliberately deferred

| Item                        | Why deferred                               | Trigger to revisit                                         |
| --------------------------- | ------------------------------------------ | ---------------------------------------------------------- |
| Real payment provider       | Not chosen; the port and mock are complete | Before any real-money pilot (KYC takes weeks — start then) |
| Redis                       | Not needed at launch volume                | A measured rate-limit or cache need                        |
| Seller feed/API integration | Spreadsheet + portal suffice               | A partner asks and ops can support it                      |
| Photographic visualization  | Concept mode meets LOG-011                 | Product decision                                           |
| Multi-region                | Multi-AZ meets RPO/RTO                     | After launch metrics                                       |
| Seller self-registration    | Verification throughput unknown            | Measured ops capacity                                      |
| TypeScript 7                | Lint toolchain support                     | typescript-eslint supports it                              |
