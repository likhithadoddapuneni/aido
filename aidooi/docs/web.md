# Web apps: toolchain, components, conventions

Applies to `apps/seller-portal` and `apps/ops-console` (Vite + React SPAs) and anything else that renders in
a browser. Everything shared lives in `packages/ui-web`. The plan above it is `clients.md`; platform
decisions are in `adrs.md` (ADR-005 Arabic/RTL, ADR-014 web clients, ADR-048 design system).

## Toolchain (decided)

| Concern      | Choice                                                               | Why                                                                                  |
| ------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| UI           | React 19                                                             | Stable, the team's baseline; `<Context value>` and `ref` as props remove boilerplate |
| Build        | Vite 8 + `@vitejs/plugin-react`                                      | Fast dev loop, no config for TS source packages                                      |
| Language     | TypeScript strict, erasable syntax, `.ts`/`.tsx` import extensions   | Same rules as the backend (ADR-010)                                                  |
| Server state | TanStack Query v5                                                    | One cache; retry rules centralised in `shouldRetry`                                  |
| Styling      | **One plain CSS file** on design-token variables, logical properties | No runtime, no build plugin; RTL is automatic                                        |
| Tests        | Vitest + jsdom + Testing Library + user-event + `vitest-axe`         | Component behaviour and accessibility in CI                                          |
| E2E          | Playwright (config provided; browsers installed on demand)           | Real keyboard, real RTL layout                                                       |

Workspace packages (`@aidooi/ui-tokens`, `i18n`, `api-client`, `contracts`, `ui-web`) are TypeScript consumed as
source. pnpm links them to real paths outside `node_modules`, so Vite transpiles them with the app: there is
no package build step and no stale `dist`.

**Playwright browsers** are a ~150 MB download and are not fetched by `pnpm install`. Run
`pnpm --filter @aidooi/ui-web e2e:install` once per machine (and before the e2e job in CI), then
`pnpm --filter @aidooi/ui-web e2e`.

## Starting an app

```ts
// apps/<app>/vite.config.ts
import { defineAppConfig } from '@aidooi/ui-web/vite';
export default defineAppConfig({ server: { proxy: { '/v1': 'http://localhost:3000' } } });
```

```jsonc
// apps/<app>/tsconfig.json
{ "extends": "@aidooi/ui-web/tsconfig.app.json", "include": ["src", "test"] }
```

```ts
// apps/<app>/src/main.tsx
import '@aidooi/ui-tokens/tokens.css'; // variables first,
import '@aidooi/ui-web/styles.css'; // then components
```

Compose providers once, outermost first: `LocaleProvider` → `AuthProvider` → `ApiProvider` → `ToastProvider` → router.
Create the API client with the browser session store and send the user to sign-in when it gives up:

```ts
const store = createBrowserSessionStore({ persist: true });
const api = createApi({
  baseUrl: '',
  store,
  appVersion: __APP_VERSION__,
  onSignedOut: () => router.navigate('/sign-in'),
});
```

Test setup for an app: `setupFiles: ['@aidooi/ui-web/test-setup']`, `environment: 'jsdom'`.

### Why `sessionStorage`, never `localStorage`, for staff sessions

`localStorage` lives forever, is shared by every tab, and is readable by any script that ever runs on the
origin: a long-lived staff token there turns a single XSS into a durable account takeover. `sessionStorage`
is per tab and dies with it, so a session ends with the working session; mandatory 2FA makes the re-login
cheap. The default (`persist: false`) keeps the token in memory only. The refresh token is single-use and
the server treats reuse as theft, so the store must be written atomically and never mirrored elsewhere.

## Component conventions

- **Tokens only.** No hex colours, no pixel spacing literals that have a token. A test reads the stylesheet
  and fails on a raw colour or any physical `left`/`right`/`margin-left`/`width`-style property.
- **Logical properties.** `inline-size`, `padding-inline`, `inset-inline-start`, `text-align: start`. A layout
  written this way is already correct in Arabic. Never position by `left`/`right`.
- **The accessible name is required, not optional.** `IconButton` takes `label`; `DataTable` takes `caption`.
- **Status is never colour alone.** `StatusPill` renders the status as text; the dot is decoration.
- **Errors in words.** `ErrorState`, `useProblemText` and `Field` turn an `ApiProblem` into
  `errorMessage(code, locale)`. Screens switch on `code`, never on `message`. Never print a raw code or stack.
- **Money is integer fils.** Render with `<Money fils={…} />`; never format by hand, never divide in a screen.
- **Time** renders in `Asia/Dubai` by default via `<DateTime>`; pass `timeZone` only with a reason.
- **Controlled where the app owns the data.** `DataTable` sort/selection, `Tabs` value, pagination are props;
  the library keeps only view state (roving focus, open menus).
- **No component fetches.** Data enters through props; fetching lives in the screen with `useApi` + TanStack Query.
- **Overlays** (`Dialog`, `Drawer`, `ConfirmDialog`) trap focus, close on Escape, lock scroll and return focus.
  Destructive confirmations take `requireWord`; a failing `onConfirm` keeps the dialog open and shows why.

## Adding a screen

1. Add the route; wrap the page in `PageHeader` (one `<h1>`).
2. Query with `useQuery({ queryKey, queryFn: () => unwrap(api.http.GET('/v1/…', …)) })`. List screens use
   `useCursorPagination()`: pass `cursor` to the query, `CursorPagination` to the controls, and `reset()`
   whenever a filter or sort changes.
3. Render with `DataTable` (loading, empty and error states are built in) or `Card`/`KeyValueList`.
4. Mutations: `useApiMutation(fn, { idempotent: true })` for anything that spends money or creates a record
   a retry could duplicate; pass `ctx.idempotencyKey` as the `Idempotency-Key` header. Show failures with
   `ErrorState`/`FormErrorSummary` and success with `useToast().push`.
5. Forms: `Field` around each control; on a 400 pass `error.fieldErrors` to `FormErrorSummary` and the
   per-field messages to `Field error=`. Use the API path as the control `id` so the summary can focus it.
6. Add the screen's copy to the **app's** catalogue in both languages; do not hard-code English.
7. Add a test: render in `en` and `ar`, drive it with the keyboard, assert with `expectNoViolations`.

## i18n

Built-in component labels come from `useT()` (`messages.ts`, both languages, typed so a missing Arabic key
fails to compile). API errors come from `@aidooi/i18n` and are complete by construction (a test scans the API
for codes). `LocaleProvider` sets `document.dir` and `lang`; the shell's language select calls `setLocale`.
Format numbers and money by locale; the wire format is always fils. Arabic uses Western digits with the
د.إ sign in the UAE convention.

## Accessibility checklist (WCAG 2.2 AA)

- [ ] One `<h1>` per page, headings in order; landmarks from `AppShell` (banner, nav, main).
- [ ] Everything operable by keyboard alone; focus visible; no keyboard trap except modal overlays.
- [ ] Skip link works; focus lands somewhere sensible after navigation and after closing an overlay.
- [ ] Every control has a visible label (`Field`) or an `aria-label`; errors are announced and linked.
- [ ] Targets ≥ 44 px; text contrast from the token pairs (`CONTENT_PAIRS`); no meaning from colour alone.
- [ ] Reduced motion respected; nothing flashes.
- [ ] Both locales: screen reads right-to-left, icons that imply direction are mirrored.
- [ ] `expectNoViolations` passes (it catches about half of real issues; the keyboard tests cover the rest).
- [ ] Tested with a screen reader before launch (VoiceOver + NVDA), at 200% zoom and at 320 px.

## Playground

`pnpm --filter @aidooi/ui-web dev:playground` serves a gallery of every component with an English/Arabic
switch. `pnpm --filter @aidooi/ui-web build:playground` is the build proof run in CI. The gallery examples are
also the test fixtures for the accessibility and RTL sweep, so a new component is added to `playground/examples.tsx`
and gets both checks for free.
