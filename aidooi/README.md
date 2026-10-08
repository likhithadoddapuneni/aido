# AIDOOi platform

Multi-seller furnishing marketplace for the UAE. **Buyers** describe a room or property and receive coordinated
compositions built from products really in stock; **sellers** manage offers and fulfil orders; **AIDOOi operations**
verify data, handle exceptions and settle partners. English and Arabic (RTL) throughout.

## Layout

| Path                                        | What it is                                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain`                           | Pure business logic: money (integer fils), state machines, the standards tables, the recommendation engine, deposits, order split, refund routing, settlement. No I/O, no clock |
| `packages/db`                               | PostgreSQL schema (one schema per module), forward-only migrations, row-level security, durable jobs                                                                            |
| `packages/contracts`                        | Zod schemas for the HTTP API → OpenAPI (`openapi.json`)                                                                                                                         |
| `packages/api-client`                       | Typed client: token refresh (single-flight), idempotent retries, problem errors                                                                                                 |
| `packages/i18n`                             | en/ar error messages (every API error code is covered by a test) and money formatting                                                                                           |
| `packages/ui-tokens`, `ui-native`, `ui-web` | Design system (AID-DATA-015) as data, React Native components, React web components                                                                                             |
| `apps/api`                                  | Fastify modular monolith: API, background worker, migrator (one image)                                                                                                          |
| `apps/buyer`                                | Expo app (iOS, Android, web)                                                                                                                                                    |
| `apps/seller-app`                           | Expo shop-floor app for seller staff                                                                                                                                            |
| `apps/seller-portal`, `apps/ops-console`    | Vite + React SPAs                                                                                                                                                               |
| `docs/adrs.md`                              | Every architectural decision, with reasons and what was rejected                                                                                                                |
| `docs/`                                     | `deployment.md`, `clients.md`, `mobile.md`, `web.md`, `module-guide.md`                                                                                                         |

## Run it

Node ≥ 22.18, pnpm 10 (`corepack`), Docker.

```bash
pnpm install
pnpm db:up                       # PostgreSQL 16 on :5433
pnpm check                       # format, lint, typecheck, every test, drift checks
docker compose --profile app up --build   # migrate + API + worker from the production image
```

After `pnpm openapi` (regenerates the OpenAPI document and the client types), CI fails if either is stale.

## What the tests prove

`apps/api/test/journey.e2e.test.ts` walks the whole product through real HTTP and a real database — guest →
sign-in → recommendation → viewing and deposit → checkout with the deposit credited → delivery → settlement —
and asserts that every dirham is accounted for. Beyond it: a differential test against the reviewed prototype,
property tests on money and settlement, real-Postgres tests of every constraint, trigger and row-level-security
policy, concurrency tests (12 buyers racing for 3 units, simultaneous payments), a payment-gateway contract
suite, and browser end-to-end runs for the seller portal and ops console.

## Honest limits

No real payment provider yet (the mock is refused in production); no infrastructure-as-code (nothing to validate
it against here); nothing has been run on a physical phone. See `docs/deployment.md` — _Verified vs not verified_
and _Known limitations_.
