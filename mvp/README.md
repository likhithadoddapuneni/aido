# AIDOOi MVP — how to run it

This folder is the **running AIDOOi MVP**. It has no build step, no package manager, no database
and no accounts. Everything — the catalogue, the recommendation engine, viewing, checkout, orders
and settlement — runs in the browser.

---

## 1. Run it

### The one command you need

```bash
cd "/Users/rahul/Downloads/likhi project/mvp"
python3 -m http.server 8777
```

Then open **<http://localhost:8777>** in Chrome, Safari, Edge or Firefox.

Stop the server with `Ctrl + C`.

### Why a server, and not just double-clicking index.html

The app is written as native **ES modules** (`<script type="module">`). Browsers refuse to load
modules over the `file://` protocol for security reasons, so opening `index.html` directly shows a
blank page and a CORS error in the console. Any static file server fixes this.

### Alternatives, if you do not have Python

| You have | Command |
|---|---|
| Node.js | `npx serve -l 8777` &nbsp;or&nbsp; `npx http-server -p 8777` |
| PHP | `php -S localhost:8777` |
| VS Code | Right-click `index.html` → **Open with Live Server** |
| Ruby | `ruby -run -e httpd . -p 8777` |

### Port already in use?

```bash
lsof -ti:8777 | xargs kill      # free the port
python3 -m http.server 8080     # or just pick another one
```

### Showing it to someone on another machine

On the same Wi-Fi, find your local IP and share it:

```bash
ipconfig getifaddr en0          # macOS, e.g. 192.168.1.24
# the other person opens http://192.168.1.24:8777
```

---

## 2. A five-minute demo path

This is the route to walk a client through. It touches all eight workflows.

| # | Do this | What to point out |
|---|---|---|
| 1 | Home → **Find my best match** | 601 verified products and 851 live seller offers behind the page |
| 2 | Choose **Living Room** | One entry question routes into one of eight paths (AID-SPC-001) |
| 3 | Enter length `5.5`, width `4.5` | 24.8 m² → size classification **Medium**, derived by the system, never chosen by the customer |
| 4 | Pick **Scandinavian** and **Beige** | Controlled vocabularies, not free text (AID-DATA-009 / 007) |
| 5 | Pick the **Standard** budget card | Each tier card carries its AED range and a representative product image |
| 6 | **Generate my recommendations** | Four complete options, each with its composition score |
| 7 | **View & visualize** on Best Overall | Measured plan drawn to scale; toggle to **Gallery** |
| 8 | Click any item on the plan | The Product Card opens with the full AID-LOG-009 score breakdown |
| 9 | **Replace** a product | Only eligible alternatives; the composition is revalidated before it applies |
| 10 | **Remove** a non-essential item | Total recalculates instantly; essentials refuse to be removed |
| 11 | **Request viewing** → register | Guests explore freely; registration is required only here |
| 12 | Confirm sellers → pay deposit | 5% of the selected products, capped at AED 500 |
| 13 | **Record attendance** → checkout | The deposit becomes a credit against the order |
| 14 | **Pay** | One payment to AIDOOi, split into seller orders with locked snapshots |
| 15 | Advance a line to **Receipt Confirmed** | It becomes settlement eligible |
| 16 | **Report issue** on another line | Settlement goes On Hold |
| 17 | Scroll to the settlement table | Gross − commission − adjustments = net payable, per partner |
| 18 | **Engine** in the top navigation | Every MVP acceptance gate, evaluated live |

Things worth trying off the happy path:

- A **tiny room** (2.8 × 2.6 living room) — watch the composition shrink rather than break.
- A **Luxury** tier — Premium Choice is suppressed with a stated reason, because no meaningful
  upgrade exists. The system refuses to manufacture a fourth option.
- **Villa** with 4 bedrooms and 2 floors — eight coordinated room modules from one budget.
- **Individual Product** → Premium Sofa — a deliberately short list, because products below match 60
  are never shown.

---

## 3. What is in each file

```
mvp/
├── index.html              Page shell, fonts, header and footer
├── css/
│   └── aidooi.css          The whole design system as tokens (AID-DATA-015)
└── js/
    ├── standards.js        Controlled vocabularies + AID-LOG-001 price matrix
    ├── paths.js            The 8 customer paths, size classes, compositions, budgets
    ├── catalogue.js        Generated AIP / AID / AIO records and partner stores
    ├── engine.js           AID-LOG-009 scoring + AID-LOG-010 composition logic
    ├── commerce.js         Viewing, deposit, checkout, orders, settlement
    ├── art.js              Product illustrations drawn from each product's own data
    ├── ui.js               Brand mark, icons, the measured room plan
    └── app.js              Router, views and all user actions
```

Every file cites the standard section that governs each decision, in comments at the decision point.
If a number looks arbitrary, the citation next to it says where it came from.

For a full section-by-section explanation of every screen and module, see
[`../docs/06-mvp-walkthrough.md`](../docs/06-mvp-walkthrough.md).

---

## 4. How the data behaves

- The catalogue is **generated deterministically** at page load from a fixed seed, so the same
  products, prices and stock appear on every machine and in every demo.
- Prices come from the **AID-LOG-001 tier bands** for each product type and size branch — they are
  not random numbers.
- Only `Verified` + `Active` products with an in-stock, active offer can enter recommendation. That
  gate is real; it is the first MVP acceptance gate.

### Resetting between demos

Click **Reset demo data** in the footer, or clear the site's local storage. Only your name and
current project are stored locally — nothing is sent anywhere.

---

## 5. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Blank page, CORS error in console | Opened `index.html` directly | Serve it over HTTP (section 1) |
| Blank page, 404 on `js/app.js` | Server started from the wrong folder | `cd` into `mvp/` first |
| Fonts look wrong | Google Fonts blocked or offline | Harmless — the system fallbacks are set |
| Nothing happens on a button | Stale cached module | Hard reload: `Cmd/Ctrl + Shift + R` |
| "Generate" stays greyed out | A required input is missing | Complete dimensions, any conditional input, and a budget tier |

---

## 6. What this build is, and is not

**It is** the complete customer journey and the complete decision logic: the real AID-LOG-009 scoring
weights, the real AID-LOG-010 composition rules and thresholds, the real deposit and settlement
arithmetic, and the real state machines.

**It is not** production infrastructure. There is no database, no authentication, no payment
provider and no admin back office — by design. Those are Phase 1, 6 and 7 of the Master Plan build
sequence. See `../docs/04-build-plan.md` for what each phase still needs, and
`../docs/05-gaps-and-decisions.md` for the 14 places where the standards are silent and a decision
had to be taken.
