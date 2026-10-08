# Mobile toolchain

Decided and verified in this monorepo (pnpm 10, Node ≥ 22.18). Read with `clients.md`.

## Versions (pinned)

Taken from Expo SDK 57's `bundledNativeModules.json`, i.e. the set Expo tests together — **not** the newest
version of each package. When upgrading, move the whole set (`expo install --check` resolution) in one change.

| Package                        | Version                                                                |
| ------------------------------ | ---------------------------------------------------------------------- |
| expo                           | ~57.0.27                                                               |
| react / react-dom              | 19.2.3                                                                 |
| react-native                   | 0.86.3                                                                 |
| expo-router                    | ~57.0.25                                                               |
| react-native-svg               | 15.15.4                                                                |
| react-native-safe-area-context | ~5.7.0                                                                 |
| react-native-screens           | ~4.26.0                                                                |
| react-native-web               | ~0.21.0                                                                |
| jest-expo / jest               | ~57.0.5 / ^29.7 (jest-expo's own peer range; Jest 30 is not supported) |
| @testing-library/react-native  | 14.0.1 (async API: `await render(...)`, `await fireEvent.press(...)`)  |

## Layout

```
packages/ui-tokens   design system as data (no React)
packages/i18n        catalogues + errorMessage()
packages/ui-native   React Native components (this doc)
apps/buyer           Expo Router app: iOS, Android, web
```

Workspace packages are **TypeScript source** consumed directly (ADR-010), including their `.ts`/`.tsx`
import specifiers. Metro and Babel (`babel-preset-expo`) resolve and transform them without configuration.

## What was needed — and what was not

- **No `node-linker=hoisted`, no `.npmrc` change.** Expo's default Metro config already watches the workspace
  root and follows pnpm's symlinks. `apps/buyer/metro.config.js` is just `getDefaultConfig(__dirname)`.
- **One `react` / `react-native` per app.** Packages that need them declare them as `peerDependencies` pinned to the same
  version as the app, so pnpm links one copy. Two copies cause "invalid hook call" errors that only appear at runtime.
- **Jest:** `jest-expo` preset; `transformIgnorePatterns` must allow pnpm's `.pnpm/<pkg>/node_modules/` layout and our own
  workspace source (see `packages/ui-native/jest.config.cjs`). Config files are `.cjs` because the package is `"type": "module"`.
- **ESLint:** `babel.config`, `metro.config`, `jest.config` are CommonJS; one scoped entry in `eslint.config.js` declares that.

## Commands

```bash
pnpm --filter @aidooi/buyer start            # dev server (needs a simulator or Expo Go)
pnpm --filter @aidooi/buyer export:web       # production web bundle → apps/buyer/dist
pnpm --filter @aidooi/buyer export:ios       # JS bundle for iOS (no simulator required)
pnpm --filter @aidooi/buyer export:android   # JS bundle for Android
pnpm --filter @aidooi/ui-native test         # component tests (jest-expo)
pnpm --filter @aidooi/buyer test
pnpm typecheck
```

Native binaries (`expo run:ios`, EAS Build) need Xcode / the Android SDK and are outside what CI here can run. The three
`export` commands are the proof that the code bundles for every platform; device behaviour is verified on real devices.

## Gotchas

1. **Fonts.** Tokens carry CSS font stacks. Native needs ONE family name and it must match the name registered with
   `expo-font` (`Cormorant Garamond`, `Inter`, `IBM Plex Sans Arabic`, `Noto Naskh Arabic`). `fontFamily()` picks the
   first name on native and the whole stack on web. Until the app loads the fonts, the system font shows.
2. **RTL needs a reload on native.** `I18nManager.forceRTL` applies at next launch. `applyLocale(locale)` sets it and
   returns `{ needsReload }`; the app reloads (e.g. `expo-updates` `reloadAsync`) when true. On web there is nothing to reload.
   Components use logical properties only (`marginStart`, `insetInlineStart`, `borderTopStartRadius`); a test fails the
   build if a physical left/right style appears (the concept plan's drawing is the one deliberate exception).
3. **No hard-coded design values.** A test fails the build on any hex/rgb colour or raw spacing/radius/font-size number
   (other than 0 and 1) in `ui-native` source. Everything comes from `@aidooi/ui-tokens`.
4. **Accessibility grouping.** A container that holds a button (Banner with an action, ErrorView with Retry) is _not_
   grouped as one accessible element, or the button would become unreachable by screen readers.
5. **`@aidooi/api-client` is not a dependency of `ui-native`.** `ErrorView` duck-types an `ApiProblem` so the component
   library carries no network code (and Jest need not transform `openapi-fetch`, which is ESM-only).
6. **react-dom duplicates.** Other packages in the repo (web apps) may resolve a newer `react-dom`; the mobile app
   pins 19.2.3 and pnpm keeps both copies separate. Do not hoist.

## `@aidooi/ui-native`

Light theme only (AID-DATA-015). Every component is token-driven, RTL-correct, accessible (roles, labels, 44 pt targets,
dynamic type with ceilings, reduced motion) and tested in English and Arabic.

`Text` · `Button` (async-safe: ignores taps until the action settles) · `Card` · `Field` · `PhoneField` (UAE → E.164) ·
`OtpField` (paste, autofill, Arabic digits) · `Badge` · `Chip` · `Money` (integer fils only) · `Screen` · `Banner` ·
`EmptyState` · `Skeleton` · `ListRow` · `ProgressDots` · `QuantityStepper` · `SegmentedControl` · `BottomSheet` ·
`ToastProvider`/`useToast` · `ErrorView` · `ConceptPlan` · `ThemeProvider` · `LocaleProvider`/`useLocale`/`useT`/`applyLocale`.

### Concept plan layout

`layoutPlan()` (pure, property-tested): explicit positions are kept (clamped into the room) unless they collide; everything
else is placed largest-first at the first free spot found by scanning row by row in 10 cm steps, `clearance` (10 cm) from
the walls and from each other. Anything that cannot fit is returned in `unplaced` and reported — never drawn overlapping
or outside the walls. The same input always gives the same plan. The plan is labelled **Concept** (AID-LOG-011).
