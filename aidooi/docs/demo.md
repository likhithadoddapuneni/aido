# Running the demo on this machine

This machine is the server. One command starts the whole platform with seeded data; any browser on this
machine, any device on the same Wi-Fi, or an agentic IDE such as Antigravity can then use it.

```bash
scripts/demo.sh up       # Postgres, migrations, seed data, API, worker, both consoles, both Expo apps
scripts/demo.sh status   # URLs, and whether each service is up
scripts/demo.sh down     # stop everything it started
scripts/demo.sh reset    # drop the demo database; the next `up` re-seeds
```

`up` is safe to repeat. **Development only:** fixed demo passwords, sign-in codes printed to a log, mock payments.
Never expose these ports to the internet.

## What runs where (replace the host with the one `status` prints, or `localhost` on this machine)

| Port | What                  | Open in                                                       |
| ---- | --------------------- | ------------------------------------------------------------- |
| 3000 | API (`/health/ready`) | —                                                             |
| 5173 | Seller portal         | any browser                                                   |
| 5175 | Ops console           | any browser                                                   |
| 8081 | Buyer app (Expo web)  | any browser; or **Expo Go** on a phone at `exp://<host>:8081` |
| 8082 | Seller app (Expo web) | any browser; or **Expo Go** at `exp://<host>:8082`            |

Port 5174 is deliberately not used (another project of yours listens there).

## Logging in

- **Staff** (`.demo/credentials.json` lists every login, the password and the authenticator secret):
  `admin@`, `catalogue@`, `support@`, `finance1@`, `finance2@`, `owner@` (seller owner), `staff@` (seller staff)
  — all `@demo.aidooi.test`, password `Demo-password-2026!`.
  The two-step code changes every 30 s: `pnpm --filter @aidooi/api demo:totp finance1@demo.aidooi.test`.
- **Buyer**: sign in with any UAE number (e.g. `+971501234567`); the code is printed in the API log:
  `grep "DEMO OTP" .demo/logs/api.log | tail -1`.
- **Test cards** (mock payments are on): `tok_ok` pays; `tok_decline`, `tok_3ds`, `tok_flaky_once` fail on purpose.

## A checklist for an agent (or a person) checking the product

1. **Buyer web** `:8081` — pick _Living room_, 5 × 4 m, Scandinavian, Standard → four options, scores, a
   top-down concept plan; tap a product → Product Card; replace one item, remove another; switch to Arabic and
   confirm the layout mirrors.
2. **Buy** — sign in (code from the log), _See in store_ is optional; _Buy_ → pay with `tok_ok` → one order.
   Try `tok_decline` first to see a declined payment end cleanly, and `tok_3ds` for the bank step.
3. **Seller portal** `:5173` as `owner@` — Offers: change a price; Orders: advance the new order line
   through _Preparing → Ready → Dispatched → Delivered_ (delivery proof needs photo storage, which is not
   configured in the demo — use the seller app's flow or expect that error).
4. **Buyer** — confirm receipt of each item; the order shows _Completed_.
5. **Ops console** `:5175` — as `catalogue@` open _Product verification_; as `finance1@` create a settlement
   run for the current month; try to approve it as `finance1@` (refused: four-eyes), approve as `finance2@`,
   mark paid. As `admin@`, _Compatibility maps_ shows the approved version.
6. **Seller app** `:8082` — sign in as `staff@`; Tasks, Check-in, Orders, Stock.

## Real devices and simulators — what this machine can do

- **Browser (works now, lightest):** Expo web renders the real React Native code; layout, flows, Arabic/RTL and
  every API interaction are checked this way. It is not native: no camera QR scan, push, secure storage or
  native text rendering.
- **Phone with Expo Go (true native, no installs on this machine):** phone and this machine on the same Wi-Fi;
  open `exp://<host>:8081`. Requires an Expo Go build that supports the SDK in `docs/mobile.md` (SDK 57); if the
  store version is older, use the browser or build a development client.
- **iOS Simulator:** not available — only the Command Line Tools are installed, and the simulator needs full
  Xcode (~15 GB, from the App Store).
- **Android emulator (Android Studio):** yes, this works and is the best "simulator" option for this machine.
  This Mac is Apple silicon (`arm64`), so pick an **arm64-v8a** system image. Steps: install Android Studio →
  _Device Manager_ → create a Pixel with a recent image **that includes Google Play** → start it. Then run
  `scripts/demo.sh up` and, in the Expo terminal for the app you want, press `a` (or open `exp://<host>:8081`
  inside **Expo Go** on the emulator). The emulator reaches this machine at either the LAN address or `10.0.2.2`.
  Expect a few GB of disk and a slow first boot. Two caveats: Expo Go must support SDK 57 (otherwise build a
  development client with `npx expo run:android`, which also needs a JDK), and the emulator's "camera" is a
  virtual scene, so QR check-in is exercised with the emulator's virtual camera or the manual-code field.
- Nothing in this repository has been run on a physical device yet; a first Expo Go pass on a phone is the most
  valuable remaining check (fonts, RTL after reload, camera, push).

## Known demo limitations

Photo uploads (product photos, delivery proof) fail because no object storage is configured; push and
WhatsApp delivery are log-only; Apple/Google sign-in is disabled (not configured).

## Android emulator on this machine (set up and tested)

Installed: Android Studio (`brew install --cask android-studio`), the SDK in `~/Library/Android/sdk`
(platform-tools, emulator, Android 15 arm64 Google Play image, command-line tools), and a virtual Pixel 8 named
`aidooi_pixel`. To run the buyer app on it:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"; export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"
emulator -avd aidooi_pixel -no-snapshot -no-audio -gpu host -cores 2     # opens the phone window
scripts/demo.sh up                                                        # API, database, seed data, Expo servers
adb shell am start -a android.intent.action.VIEW -d "exp://<host>:8081"   # Expo Go downloads itself on first use
```

Tested: Expo Go (SDK 57) installs and runs the buyer app; guest session, wizard, budgets, recommendations,
the concept room view and the Product Card all work against this machine's API.

**Memory is tight on an 8 GB Mac.** With Docker, five dev servers, a browser and the emulator all running, Android's
system process stopped responding. For phone testing stop what you don't need (`kill` the seller-portal,
ops-console and seller-app servers) — the API, database and the one Expo server for the app under test are enough.
