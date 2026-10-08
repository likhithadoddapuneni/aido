# 04 — Build plan

The Master Plan's §8 sequence, with what the prototype in `mvp/` already proves and what a production
build still needs.

---

## Phase map

| Phase | Master Plan scope | Prototype status | Production work remaining |
|---|---|---|---|
| **1 · Foundation** | DB/entity model, IDs, taxonomy, product/offer/partner data, auth, admin foundation | Entity model implemented in memory; AIP/AID/AIO sequences and the Verified/Active gate are real | Real schema (`docs/03`), migrations, auth, guest→registered upgrade, admin CRUD |
| **2 · Customer profiling** | SPC routing, room/property inputs, style/colour/budget UI, project persistence | **All eight paths** working, size classes derived, lean inputs, controlled vocabularies | Persist projects, optional media upload and storage |
| **3 · Recommendation** | Hard filters, LOG-009 scoring, LOG-010 composition, presentation | **Complete** — weights, thresholds, tie-breaks, four objectives, anchor diversity, premium suppression | Move to a service, persist runs and rejection reasons, performance work at catalogue scale |
| **4 · Visualization** | LOG-011 integration, Product Cards, replacement/revalidation | Concept visualization from verified dimensions, hotspots → AID/AIO, replace with revalidation | Product-faithful rendering pipeline if required beyond Concept mode |
| **5 · Viewing** | Seller confirmation, 5% capped deposit, Viewing ID/QR, stops, attendance, refund/credit, attribution | **Complete as logic** — stops, confirmations, deposit maths, QR pass, outcomes, attribution trail | Real QR, partner notification channel, deposit capture/refund via the payment provider |
| **6 · Commerce** | Final validation, 24-hour reservation, one checkout/payment, order splitting, snapshots | **Complete as logic** — validation, reservation window, single payment, master/seller/line split, locked snapshots | Payment provider integration, idempotency, reconciliation |
| **7 · Operations** | Fulfilment status, issues, receipt confirmation, settlement eligibility, monthly settlement | Line state machine, 72-hour auto-confirm rule, issue flags, holds, settlement run | Admin back office, telephone-status capture workflow, partner statements |
| **8 · QA / Acceptance** | Validate every path and critical transition against the standards | Engine Console evaluates each acceptance gate live | Automated test suite per gate, fixture catalogue, regression runs |

---

## Suggested delivery order for a production build

1. **Schema + ingestion first.** Nothing else is testable until AIP/AID/AIO records exist with real
   partner data. Budget real time for catalogue standardisation — AID-DATA-001–014 is a data-quality
   project, not a form.
2. **Recommendation as a service, behind a stable contract.** The scoring is the product. Port it
   from `mvp/js/engine.js`, add persistence of `candidate_score` rows, and build the test fixtures
   before tuning anything.
3. **The commerce spine next** (validation → reservation → payment → split → snapshot). It has the
   hardest correctness requirements and the strictest acceptance gates.
4. **Viewing after commerce**, because the deposit credit mechanic depends on the payment layer.
5. **Admin and settlement last**, but do not defer the audit trail — retrofitting `audit_event` is
   expensive and the standards require it from LOG-012 onwards.

---

## Risk notes

| Risk | Why it matters | Mitigation |
|---|---|---|
| Catalogue quality | Recommendation quality is bounded by data quality. A missing width makes a product ineligible for fit scoring | Treat AID-DATA-014 verification as a gate with a human owner, not a flag |
| Thin inventory per slot | With few verified products, the four options collapse into near-duplicates | The standards already answer this: surface *Limited Inventory* rather than lower quality. Do not weaken thresholds |
| Compatibility maps | Style/colour maps are hand-maintained and drive 40% of the product score | Version them, review them, and never replace them with free model interpretation (LOG-009 §12) |
| Seller confirmation latency | Viewing and checkout both block on partner response | The 24-hour window and reconfirmation rules exist for this; instrument the response times early |
| Price movement between recommendation and payment | Snapshot timing | Validate at checkout, require customer approval on change, lock snapshot only at successful payment |

---

## What the prototype is useful for right now

- **Demonstrating the product** to a stakeholder in five minutes, end to end.
- **Pressure-testing the standards** — several ambiguities in `docs/05` were only visible once the
  rules were executed rather than read.
- **Fixing the UI language** — AID-DATA-015 is fully implemented in `mvp/css/aidooi.css` as tokens.
- **Writing acceptance tests** — each gate in the Engine Console maps to a check a test suite can own.
