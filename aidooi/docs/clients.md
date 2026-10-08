# Client architecture

Four front ends, one API, one design system. This file is the plan every client is built to; decisions
that change the platform go in `adrs.md`.

| App                  | Who                            | Tech                                                                          | Notes                                         |
| -------------------- | ------------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------- |
| `apps/buyer`         | Buyers                         | Expo (React Native) + Expo Router; iOS, Android **and web** from one codebase | Arabic + English, RTL                         |
| `apps/seller-app`    | Seller staff on the shop floor | Expo; iOS, Android                                                            | Confirmations, QR check-in, fulfilment, stock |
| `apps/seller-portal` | Seller owners and managers     | Vite + React SPA                                                              | Catalogue, imports, team, statements          |
| `apps/ops-console`   | AIDOOi staff                   | Vite + React SPA                                                              | Verification, partners, desk, governance      |

## Shared packages

```
packages/ui-tokens   design system as data (done)         → RN values + generated CSS variables
packages/api-client  typed client generated from OpenAPI   → every app talks to the API only through this
packages/i18n        en/ar catalogues, error-code messages → one source of copy
```

### `api-client`

Types come from `packages/contracts/openapi.json` (`openapi-typescript`); calls go through
`openapi-fetch`. A thin wrapper adds what every client needs and none should re-implement:

- **Auth:** attaches the access token; on a 401 `invalid_token`, refreshes **once, single-flight** (parallel
  requests wait for the same refresh), retries the original, and signs out if the refresh is rejected.
  Refresh-token **reuse is fatal by design** (the server revokes the family), so the client must never
  send the same refresh token twice — hence single-flight and atomic token storage.
- **Problems:** every non-2xx becomes an `ApiProblem` (`status`, `code`, `detail`, `correlationId`,
  field `errors`). Screens switch on `code`, never on message text.
- **Idempotency:** `idempotencyKey()` creates the key for a _user intent_ (one tap on Pay) and the wrapper
  reuses it for retries of that intent. A 503/network failure retries with the **same** key, so a flaky
  connection can never double-charge.
- **Headers:** `x-correlation-id` (also shown to the user in error screens, so support can find the request)
  and `x-app-version` (the API can force an upgrade with 426).

### `i18n`

English and Arabic from the first screen. Strings are keys, never literals in components. **Every error
code the API can return has a user-facing message in both languages**; a test scans the API source for
codes and fails if one is missing, so a new server error can never reach a user as a raw code.
Numbers and money are formatted by locale (`AED 1,234.00`; in the UAE convention Arabic uses Western digits with the د.إ sign; the
wire format is always integers in fils). Layout uses logical properties (`start`/`end`), never `left`/`right`.

## Buyer app

```
app/
  (onboarding)/language, intro
  (tabs)/home, projects, orders, account
  project/new/[path]          one wizard per AID-SPC path; asks only what that path needs
  project/[id]/budget         the five tier cards with AED ranges
  project/[id]/options        up to four compositions, scored and explained
  composition/[id]            room view: measured concept plan, tappable products
  composition/[id]/item/[slot]  Product Card + replace
  viewing/new, viewing/[id]   stops grouped by showroom, deposit, QR pass (works offline)
  checkout/[id]               validation state, delivery address, pay (native payment SDK slot)
  orders/[id]                 one order, grouped status; report an issue
  sign-in                     phone OTP, Apple, Google; resumes the pending action
```

Decisions:

- **Server state:** TanStack Query. **Local state:** Zustand only for the wizard draft.
- **Forms:** React Hook Form + the contract's Zod schemas (the same validators the server runs).
- **Guest first:** the app opens with a guest session; browsing and profiling never need an account. At
  viewing or purchase the user signs in and the **pending action resumes** — nothing restarts.
- **The server's answer wins.** The client never computes eligibility, fit or price; it renders what the API
  returns, including `stale` flags, and offers "refresh" when a composition went stale.
- **Concept visualization:** `react-native-svg` draws a measured top-down plan from product dimensions and
  is labelled "Concept" (AID-LOG-011). Hotspots map shapes to `productId/offerId` from the API.
- **Offline:** the viewing pass (QR) and the last-seen order are cached so they open without signal;
  nothing else is cached beyond TanStack Query defaults.
- **Payments:** a `PayScreen` talks to the provider's native SDK for a token and sends it to
  `POST /checkout/{id}/pay`. Until a provider is chosen the screen uses the mock tokens in development
  only; the production build has no mock path.
- **Accessibility:** WCAG 2.2 AA, dynamic type, 44 pt targets, labelled hotspots, reduced motion.
- **Security:** tokens in the OS keychain/keystore; no PII in logs or push payloads; screenshots blocked on
  the payment screen.

## Seller app (shop floor)

Four things, fast, one-handed: **confirmations inbox** (viewing + purchase tasks with SLA countdowns),
**QR scan** (check a buyer in), **order lines** (advance status, delivery proof photo), **stock quick-edit**.
Push-first; WhatsApp is the fallback channel for sellers who have not installed it.

## Seller portal and Ops console

Data-dense desktop SPAs (TanStack Router + Table + Query), keyboard-friendly, behind the same auth with
mandatory 2FA. The seller portal covers catalogue and offer management, bulk import with row-level
errors, team, statements and performance. The ops console covers the verification queue, partner
lifecycle, compatibility-map approval, the order/customer desk with audited PII reads, settlement runs
with four-eyes approval, staff and the audit viewer.

## Quality gates for every client

1. `pnpm typecheck` strict; lint clean; no `any`.
2. Component and hook tests; the API client has contract tests against the generated spec.
3. A production build succeeds (`expo export`, `vite build`).
4. The error-code ↔ message drift test passes.
5. Both languages render every screen (RTL snapshot per screen).
6. End-to-end flows run against the real API and a seeded database: buyer happy path
   (profile → options → checkout), seller confirmation, ops verification.
