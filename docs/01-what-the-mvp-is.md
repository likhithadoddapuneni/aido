# 01 — What "build an MVP" means for AIDOOi

## The short answer

**A working web product.** Not a PowerPoint, not a Figma file, not another document.

The confusion is understandable: you were handed 52 PDFs and the word "MVP", and PDFs look like
deliverables. They are not. They are the **specification** for a product that does not exist yet.

---

## Why this is settled by the documents, not by opinion

### 1. The Master Plan hands work to developers, not to a designer

§7 is titled **"Development Modules / Handoff"** and its column heading is literally
**"Developer Deliverable"**:

| Module | Developer deliverable |
|---|---|
| Frontend Web/PWA | Responsive customer journey, recommendations, visualization interaction, viewing, checkout, orders |
| Product Data Service | Canonical products/variants, seller offers, taxonomy, attributes, media and validation |
| Recommendation Service | Hard filters, product scoring, composition generation, four-option optimization |
| Visualization Integration | Visualization request/result records, product traceability, replacement refresh |
| Viewing Service | Stops, seller confirmations, deposit, QR/pass, attendance, refund/credit and attribution |
| Commerce Service | Seller validation, reservation window, payment state, Master/Seller orders, line snapshots |
| Operations/Admin | Partner activation, product administration, fulfilment updates, issue handling |
| Settlement | Commission snapshots, line eligibility, monthly settlement calculations |
| Audit & Status History | Critical state changes, confirmations, price/commission snapshots, issue history |

### 2. The build sequence is a software build sequence

§8 runs Phase 1 → Phase 8: *database/entity model → customer profiling → recommendation →
visualization → viewing → commerce → operations → QA/acceptance*. Phase 1 opens with
"Database/entity model, IDs, taxonomy, product/offer/partner data, authentication".
You cannot deliver Phase 1 in slides.

### 3. The acceptance gates can only be passed by running code

§9 lists conditions like:

- *"No capture before all required Seller validations; no seller fulfilment before complete successful payment."*
- *"Master Order splits correctly into Seller Orders/Order Lines with locked transaction snapshots."*
- *"Deposit: 5% of selected viewing products, maximum AED 500; Completed/no purchase = full refund; purchase = full credit; No-show = non-refundable."*

These are state transitions. A deck cannot be tested against them.

### 4. Both top-level documents name the same next artifact — and it is technical

> "Next technical artifact: detailed **Master Data Dictionary & System Specification** containing
> table names, field names, data types, required/optional status, foreign keys, controlled values,
> state transitions, validation rules and API-facing objects."

That is written at the end of the Master Plan *and* at the end of the 8 Core Workflows.
It is in `docs/03-system-specification.md` here.

### 5. The brief you were sent says it outright

> "They want you to build a **complete furniture recommendation and commerce platform** that:
> profiles customer spaces, generates tailored furnishing recommendations, visualizes them, lets
> customers view products physically, handles deposits, checkout, and payments, tracks orders and
> fulfilment, and finally settles commissions with partners."

---

## So when *is* a deck the right thing?

A deck is a **wrapper**, never the deliverable:

| Situation | What to produce |
|---|---|
| You are asked to show you understood the 47 standards | A short deck or a one-page summary — but it is a *reading check*, not the MVP |
| You are pitching for the build, or reporting progress to a non-technical stakeholder | A deck **built around a live demo** |
| You are asked to deliver "the MVP" | The running product. Show the deck for five minutes, then open the app |

If someone insists on a deck, the honest structure is: the problem → the 8 workflows → **live demo** →
architecture → what is built vs what is next → timeline and cost. The demo is the centre of it.
Everything in this repository's `mvp/` folder is demo-ready today.

---

## What a *complete* production MVP includes

The prototype in `mvp/` covers the customer-facing journey and the decision logic end to end, in the
browser. A production MVP additionally needs:

1. **Persistence** — the entity model in `docs/03-system-specification.md` as a real schema.
2. **Authentication** — guest sessions that survive upgrade to a registered user at viewing/purchase.
3. **A payment provider** — card capture, refund, and the deposit credit mechanics.
4. **An admin back office** — partner activation and product verification (AID-LOG-013; there is
   deliberately *no* seller portal in MVP).
5. **Real catalogue ingestion** — partner catalogues standardised into AIP/AID/AIO records.
6. **Visualization service** — if photographic fidelity is wanted beyond AID-LOG-011's Concept mode.
7. **Operational telephony workflow** — AID-LOG-015 specifies that in MVP, partners report fulfilment
   status by telephone and AIDOOi records it.

Phasing and effort for each of these is in `docs/04-build-plan.md`.
