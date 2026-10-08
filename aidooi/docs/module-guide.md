# Module guide — how a module is built here

Read this before adding or changing anything in `apps/api/src/modules`. It is the pattern every module
follows; reviewers will hold new code to it.

## Shape

```
modules/<name>/
  routes.ts      HTTP only: parse (Zod, from @aidooi/contracts), authorise, call the service, shape the reply
  service.ts     the use cases; the only place that opens transactions
  repo.ts        SQL (Kysely) for this module's tables — optional, when queries are non-trivial
  jobs.ts        background handlers, keyed `<name>.<kind>`
  *.test.ts      or test/<name>.*.test.ts
```

Contracts for the module's HTTP surface go in `packages/contracts/src/<name>.ts` (already exported).

## Rules

1. **Business rules live in `@aidooi/domain`.** If a rule is pure (maths, a state machine, a validation),
   it belongs there with its own tests; the service only orchestrates. Do not re-implement a rule in SQL
   _or_ in a route — call the domain function. If the database also enforces it (it often does), the
   `packages/db/test/domain-parity.test.ts` pattern keeps the two equal; extend it.
2. **Authorise in the route or service, then act.** Use `requireBuyer / requireSeller / requireOps`
   (`http/actor.ts`). Row-level security isolates rows; **you** must restrict _columns_ and _actions_
   (a seller may change `stock_qty` on their own offer, never `commission_rate`).
3. **Transactions.** `runAs(ctx, req, fn)` runs under the caller's RLS identity. Platform actions that a
   user triggers but may not perform directly (create an order, move stock, create a viewing) use
   `runAsSystem(ctx, fn)` **after** the authorisation check, with an explicit ownership check inside.
4. **Every state change writes audit** with `recordAudit(trx, …)` in the same transaction.
5. **Money is `Fils` (integer).** Never a float, never a string. Convert only at the edges.
6. **Time comes from `ctx.clock`**, never `Date.now()`/`new Date()` in module code (the DB's `now()` is
   fine inside SQL). Tests move `TestClock`.
7. **Idempotency.** Any endpoint that spends money or creates something the user might retry takes an
   `Idempotency-Key` header (`IdempotencyHeaderSchema`) and stores the result in `platform.idempotency_key`
   (scope = route + actor). A retry returns the original response; the same key with a different body is 422.
8. **External effects after commit.** Notifications and anything that leaves the system are sent after the
   transaction commits (or enqueued as a job inside it). Never inside a held transaction.
9. **Errors.** Throw `HttpError` helpers (`notFound`, `conflict`, `forbidden`) or let a `RuleViolation` from
   the domain surface (it becomes 422). Never return `200` with an error body.
10. **Jobs are idempotent** and keyed by a `dedupeKey` so scheduling twice is harmless.

## Tests (non-negotiable)

- Use `test/support/harness.ts` (`startHarness`): real Postgres, the real app, seeded catalogue,
  `TestClock`, `RecordingNotifier`, `MockGateway`. Do **not** mock the database.
- Each acceptance gate the module touches gets a named test (see the Master Plan §9 list in `docs/`).
- Test the unhappy paths first: wrong actor, wrong owner, illegal transition, replayed request,
  concurrent requests, expired window, gateway timeout after the provider acted.
- Concurrency and retries are tested with real concurrent calls, not by reading the code.
- Tests are deterministic: no sleeps, no wall-clock dependence, no ordering assumptions.

## Definition of done for a module

`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` green from the repo root; every route has a
Zod request and response schema; the OpenAPI document regenerates (`pnpm --filter @aidooi/api openapi`);
no `TODO` without a linked decision in `docs/adrs.md`.

## The ledger (chart of accounts)

`commerce.ledger_entry` is double-entry: every `entry_group` must balance by commit (a trigger enforces
it). Amounts are positive fils; `direction` carries the sign. Reference the business object with
`ref_type` / `ref_id`. **Use exactly these accounts** so the modules agree:

| Account                      | Nature    | Meaning                                                                                 |
| ---------------------------- | --------- | --------------------------------------------------------------------------------------- |
| `psp_clearing`               | asset     | Money the payment provider holds for AIDOOi (captured, not yet paid out to us)          |
| `deposits_held`              | liability | Viewing deposits owed back to buyers (held, credited, refunded or forfeited)            |
| `sales_collected`            | liability | Order money collected from buyers and not yet apportioned to sellers (until settlement) |
| `seller_payable:<partnerId>` | liability | Net owed to a seller after settlement approval                                          |
| `commission_revenue`         | revenue   | AIDOOi's commission, recognised at settlement                                           |
| `forfeited_deposits_revenue` | revenue   | Deposits kept after a no-show                                                           |
| `bank`                       | asset     | AIDOOi's bank; used when a seller payout is marked paid                                 |

Postings (debit → credit):

| Event                                                             | Entries                                                                                              |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Deposit captured                                                  | `psp_clearing` → `deposits_held` (amount)                                                            |
| Deposit refunded                                                  | `deposits_held` → `psp_clearing`                                                                     |
| Deposit forfeited (no-show)                                       | `deposits_held` → `forfeited_deposits_revenue`                                                       |
| Order captured                                                    | `psp_clearing` (payable) + `deposits_held` (credit applied) → `sales_collected` (gross)              |
| Excess deposit returned when an order is smaller than the deposit | `deposits_held` → `psp_clearing`                                                                     |
| Order-line refund (to the capture)                                | `sales_collected` → `psp_clearing`                                                                   |
| Order-line refund (to the deposit payment)                        | `sales_collected` → `psp_clearing` (the provider refunds the earlier payment)                        |
| Settlement run approved                                           | `sales_collected` (gross of lines) → `seller_payable:<id>` (net) + `commission_revenue` (commission) |
| Clawback (refund after settlement)                                | `seller_payable:<id>` + `commission_revenue` → `sales_collected` … then refund as above              |
| Seller payout paid                                                | `seller_payable:<id>` → `bank`                                                                       |
