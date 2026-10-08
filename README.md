# AIDOOi — MVP

AIDOOi is an AI-powered multi-seller furniture marketplace and furnishing assistant for the UAE.
A customer describes a room or a whole property — dimensions, style, colour, budget — and AIDOOi
builds complete, coordinated furnishing options from products that are really in stock, lets the
customer see those products physically before buying, and takes a single payment that is split
across several sellers behind the scenes.

> "AIDOOi is an AI-powered multi-seller furniture marketplace and furnishing assistant… The 47
> standards define the rules for how all of these parts should work."

---

## 1. What is in this repository

| Path | What it is |
|---|---|
| `extracted/` | The 52 source PDFs: the Master Plan, the 8 Core Workflows, the 47 MVP standards |
| `docs/` | The written understanding, specification and build plan derived from those PDFs |
| `mvp/` | **A running MVP prototype** — open it and use it. Start at [`mvp/README.md`](mvp/README.md) |
| `AIDOOi_MVP_Client_Presentation.pptx` | A 4-slide client deck, with the full talk track in the speaker notes |
| `AIDOOi_MVP_Talk_Track.md` | The same script in printable form, plus likely questions and honest answers |
| `*.zip`, `*.jpeg` | Original supplied archives and brief screenshots |

The PDFs are the **specification**. They are not the product. Nothing in them is a slide deck.

---

## 2. "Build an MVP" — what that actually means here

**It means a working software product, not a PowerPoint.** This is settled by the source documents
themselves, not by preference:

- *MVP Master Plan* §7 "Development Modules / Handoff" lists **developer deliverables**:
  `Frontend Web/PWA`, `Product Data Service`, `Recommendation Service`, `Visualization Integration`,
  `Viewing Service`, `Commerce Service`, `Operations/Admin`, `Settlement`, `Audit & Status History`.
- §8 is an eight-phase **build sequence** that starts with "Database/entity model, IDs, taxonomy…
  authentication" and ends with "QA / Acceptance".
- §9 "MVP Acceptance Gates" are **runtime behaviours** you can only pass by running software:
  *"No capture before all required Seller validations"*, *"Master Order splits correctly into Seller
  Orders/Order Lines with locked transaction snapshots"*.
- The closing line of both the Master Plan and the Workflows document names the same next artifact:
  a **Master Data Dictionary & System Specification** — tables, fields, foreign keys, state
  transitions, API objects.

A deck can *present* this work. It cannot *be* it. See `docs/01-what-the-mvp-is.md` for the full
reasoning, including when a deck is still the right thing to make.

---

## 3. Run the MVP

No build step, no dependencies, no accounts.

```bash
cd mvp
python3 -m http.server 8777
# then open http://localhost:8777
```

(It uses ES modules, so it needs to be served over HTTP — opening `index.html` from the
file system will not work.)

### What you can do in it

| Workflow | What the prototype does |
|---|---|
| **WF-01** Profiling | All eight AID-SPC paths. Dimensions in, size class derived, only the questions that path needs |
| **WF-02** Recommendation | Real AID-LOG-009 scoring and AID-LOG-010 composition scoring over 600+ products and 850+ seller offers |
| **WF-03** Review & replace | Measured top-down visualization, tappable product hotspots, Product Card, replace with live revalidation, remove with instant recalculation |
| **WF-04** Viewing | Stops grouped by partner location, seller confirmation, 5% deposit capped at AED 500, Viewing ID/QR, attendance outcome, attribution trail |
| **WF-05** Checkout | Final seller validation, 24-hour purchase window, one cart → one checkout → one payment, master order split with locked snapshots |
| **WF-06/07** Fulfilment & issues | Line-level state machine, 72-hour auto-confirm rule, issue flags, settlement holds |
| **WF-08** Settlement | Gross eligible sales − commission − adjustments = net payable, per partner |
| — | An **Engine Console** (`#/standards`) showing the live scoring weights and every MVP acceptance gate |

### What it deliberately is not

- **Not a backend.** Everything runs in the browser against a generated seed catalogue. No database,
  no auth, no payment provider. The next artifact (see `docs/03-system-specification.md`) is where
  the real schema goes.
- **Not photographic visualization.** AID-LOG-011 allows Concept visualization where product-faithful
  rendering is not supportable; the prototype draws a measured plan from verified product dimensions
  and labels it `Concept`, which is exactly what the standard requires.
- **Not a seller portal.** Correct — AID-LOG-013 says there is no seller portal in MVP.

---

## 4. Where the product imagery comes from

There is no photography in this build, and the prototype does not fake any. Instead
`mvp/js/art.js` **draws every product from its own record** — product type, primary colour, material
family and real width/depth/height. A beige Scandinavian three-seater and a brown leather
mid-century three-seater render differently because the data differs, not because someone chose
two pictures. The same geometry drives the measured plan, so what you see on the plan is the
product that is actually in the composition.

That keeps two standards honest at once:

- **AID-DATA-012** — nothing is shown that the product record does not contain.
- **AID-LOG-011** — fidelity is declared (`Concept`), and every drawn shape carries its `AID` and
  current `AIO`, so tapping it opens the real Product Card.

When real photography is ingested, `productArt()` is the single function to swap out.

---

## 5. Documents

| Document | Read it for |
|---|---|
| [`docs/01-what-the-mvp-is.md`](docs/01-what-the-mvp-is.md) | The MVP-vs-deck question, answered from the source documents |
| [`docs/02-standards-digest.md`](docs/02-standards-digest.md) | All 47 standards summarised, with the numeric values the engine needs |
| [`docs/03-system-specification.md`](docs/03-system-specification.md) | Entities, fields, state machines and API surface — the "next technical artifact" the Master Plan asks for |
| [`docs/04-build-plan.md`](docs/04-build-plan.md) | The eight phases, what the prototype already proves, and what a production build still needs |
| [`docs/05-gaps-and-decisions.md`](docs/05-gaps-and-decisions.md) | Every place the standards are silent or ambiguous, and the decision taken here |
| [`docs/06-mvp-walkthrough.md`](docs/06-mvp-walkthrough.md) | Every screen of the MVP explained: what it does, what runs underneath, what to say about it |
| [`docs/07-production-architecture.md`](docs/07-production-architecture.md) | Production architecture for buyers, sellers and ops on web and mobile: stack, modules, checkout saga, security, infra, roadmap, decisions needed |
| [`mvp/README.md`](mvp/README.md) | How to run the MVP, a five-minute demo path, and troubleshooting |

---

## 6. The 47 standards at a glance

| Family | Count | Covers |
|---|---|---|
| `AID-DATA-001…015` | 15 | Product data, taxonomy, identification, pricing, availability, media, data quality, UI design system |
| `AID-CAT-001…008` | 8 | Category taxonomy and practical attributes: seating, sofas, tables, beds, storage, lighting, rugs, decor |
| `AID-SPC-001…009` | 9 | Project path classification and the inputs each customer path collects |
| `AID-LOG-001…015` | 15 | Price ranges, room/project composition logic, matching, options, visualization, viewing, administration, commerce, fulfilment |

The engine in `mvp/js/` cites the governing standard section in comments at every decision point.
