# 06 — The MVP, section by section

A walkthrough of everything in `mvp/`: every screen, what the customer does, what happens
underneath, which standard governs it, and what to say about it in a demo.

Run it first — see [`../mvp/README.md`](../mvp/README.md). Reading this with the app open
beside you is the intended way.

---

## Map of the application

Every screen is a hash route. You can jump straight to any of them in the address bar.

| # | Route | Screen | Workflow | Governing standards |
|---|---|---|---|---|
| 1 | `#/` | Home | — | AID-DATA-015 |
| 2 | `#/paths` | What are you furnishing? | WF-01 entry | AID-SPC-001 |
| 3 | `#/profile` | Path inputs, style, colour, budget | WF-01 | AID-SPC-002…009, DATA-007/009, LOG-001 |
| 4 | `#/recommendations` | The four options | WF-02 | AID-LOG-009, AID-LOG-010 |
| 5 | `#/option/<key>` | Visualization, composition, replace | WF-03 | AID-LOG-011, LOG-009/010 |
| 6 | `#/viewing` | Stops, deposit, QR, attribution | WF-04 | AID-LOG-012 Rev 2, LOG-013 |
| 7 | `#/checkout` | Validation, reservation, one payment | WF-05 | AID-LOG-014, LOG-013 |
| 8 | `#/orders` | Fulfilment, issues, settlement | WF-06/07/08 | AID-LOG-015, LOG-014 |
| 9 | `#/standards` | Engine console (internal) | — | Master Plan §9 |

Two screens are reached only from inside a path: the **Individual Product** results and the
**multi-module project** view both render at `#/recommendations`, because they are what that
path returns.

---

# Part A — The customer journey

## Section 1 · Home `#/`

### What you see
A split hero: the proposition on the left, a **live measured floor plan** on the right. Below
it, the three numbers that matter (601 verified products, 851 live seller offers, 6 partner
showrooms), four one-line explanations of the model, and a strip of real catalogue products.

### What happens underneath
The hero plan is not a picture. On first load the app runs a real recommendation —
a 5.4 × 4.2 m living room, Scandinavian, beige, Standard tier — and renders the resulting
composition as a plan. It is cached for the session. **If the engine broke, the home page
would be empty.** That is deliberate: the landing page is a live test of the product.

The product strip calls `repProduct(type, 'Standard')`, which pulls a genuine catalogue record
for each type, so the images reflect real colours and materials.

### Standards
AID-DATA-015 throughout — the navy/beige/ivory palette, the editorial serif display face over a
clean sans for everything functional, the generous whitespace, the "quiet navigation" rule.

### Demo note
> "Before I click anything: the room plan on the right was generated when the page loaded.
> It is the engine running, not an image."

---

## Section 2 · What are you furnishing? `#/paths`

### What you see
Eight cards: Living Room, Bedroom, Dining Room, Home Office, Studio Apartment, Full Apartment,
Villa, Individual Product. Each carries a one-line description and the two standards that
govern it.

### What happens underneath
This is **AID-SPC-001, Project Path Classification** — the single entry question. Selecting a
card creates a fresh project in state:

```js
S.project = { pathId, spec: {}, style: 'assisted', colour: 'assisted', tier: null }
```

and discards any previous run, viewing or reservation. Choosing Individual Product also seeds a
default product type and size branch so the budget cards have something to price.

The eight paths are not eight copies of one screen. They fall into three **kinds**, and the
kind decides which engine entry point runs later:

| Kind | Paths | Engine entry |
|---|---|---|
| `room` | Living Room, Bedroom, Dining Room, Home Office | `runRecommendation()` |
| `project` | Studio, Full Apartment, Villa | `runProject()` |
| `product` | Individual Product | `rankIndividual()` |

### Demo note
> "One question. Everything after this is only what the chosen path actually needs — that is
> the lean input principle in the SPC standards, and it is why this is not a twenty-field form."

---

## Section 3 · Profiling `#/profile`

The longest-running screen, and the one that does the most invisible work.

### What you see
Three panels:

1. **Left** — the path's own inputs. Dimensions for a room; bed size for a bedroom; dining
   capacity for a dining room; workspace users for an office; bedroom count and modules for an
   apartment or villa; a product type for the individual path. Plus an optional photo /
   floor-plan field.
2. **Right** — Style preference (10 choices including *Let AIDOOi decide*) and Colour direction
   (12 choices, each with its swatch).
3. **Full width** — five budget cards, each with its tier name, its numeric AED range and a
   **representative product image** for that type at that tier.

### What happens underneath

**Size classification is derived, never chosen.** The moment both dimensions are present, the
app computes the area and calls `sizeClass(pathId, area)`, then shows the result in a note:

> 24.8 m² → size classification **Medium**

Each room standard has its own bands, so the same floor area classifies differently depending on
what the room is for:

| Area | Living Room | Bedroom | Dining Room | Home Office |
|---|---|---|---|---|
| 10 m² | Compact | Small | Small | Medium |
| 16 m² | Small | Medium | Medium | Large |
| 24 m² | Medium | Large | Large | Extra Large |

That is AID-LOG-002…005 §3 implemented as written, not a simplification.

**The budget ranges follow from the size class**, which is why they only appear once dimensions
are entered. For project paths the range comes from `projectBudget()`: the published AID-LOG-007
apartment table by bedroom count, the AID-LOG-006 studio table by size class, and for a villa a
**sum of the actual room modules**, because AID-LOG-008 deliberately publishes no table.

**The representative image is a standards requirement, not decoration.** AID-LOG-001 §5 says a
budget card must show "Tier Name + Numeric AED Range + Relevant Representative Image". The size
branch is held constant across the five cards — always a 3-seater sofa, always a Queen bed — so
the cards differ by quality, not by scale.

**Nothing is free text.** Style resolves against AID-DATA-009's controlled vocabulary and colour
against AID-DATA-007's eighteen families. *Let AIDOOi decide* is a real value, not a blank: it
scores 85 on that factor, so an undecided customer is never penalised.

`Generate my recommendations` stays disabled until `profileReady()` passes — dimensions present,
any conditional input answered, and a tier chosen.

### Limits in this build
The optional photo / floor plan is accepted and stored as project context but is not parsed. The
standards are explicit that its absence must never block the path, and it does not.

### Demo note
> "Watch the note under the dimensions. The customer never picks 'small, medium or large' — they
> give us the real numbers and the system classifies the room. The budget ranges you are about to
> see are different for every size class, which is why they only appear now."

---

## Section 4 · The four options `#/recommendations`

### What you see
Up to four cards — **Best Overall Match**, **Best Value**, **Best Style Match**, **Premium
Choice** — each with a three-image strip led by its anchor product, its composition score out of
100, its total price, and its classification (Excellent / Strong / Good Composition). Best
Overall is marked *Default* and carries a navy border.

Beneath them, two notes appear when they apply: a **budget headroom** note, and a **not offered**
note naming any option that was suppressed and why.

### What happens underneath — the core of the product

This is the full `runRecommendation()` pipeline:

1. **Classify** the room and load its default composition from AID-LOG-002…005 — a list of slots,
   each with a product type, a quantity, a preferred width band in cm, a role
   (`anchor` / `core` / `secondary`) and whether it is essential.
2. **Allocate budget across slots.** Not fixed percentages — AID-LOG-007 §4 requires relative cost
   weight, so each slot's weight is the AID-LOG-001 tier midpoint for its type and branch, times
   its quantity, normalised against **92% of the ceiling**. The remaining 8% is headroom so a
   later replacement does not immediately break the budget.
3. **Build a candidate pool per slot.** Every Verified + Active product of that type, crossed with
   every Active, in-stock offer, scored by `scoreProduct()`.
4. **Score each candidate** on the six AID-LOG-009 factors — Fit 30, Style 25, Colour 15,
   Budget/Value 15, Practical 10, Availability 5 — with hard rejections applied first.
5. **Build four compositions**, one per objective, each picking from the same pool with a
   different selector, then enforcing the ceiling and finally running the "budget exceeds need"
   upgrade pass from AID-LOG-008 §6 (swap for better, never add to spend).
6. **Score each composition** on the four AID-LOG-010 factors and discard anything below 70.

**The quality floor is real.** A product scoring below 60 cannot enter a composition — not even
to fill an empty slot. A composition below 70 is never shown. If an essential slot has no
eligible candidate at all, the run fails with a stated constraint rather than returning a
half-furnished room.

**Premium Choice is suppressed when it would be fake.** It gets its own allocation pass at the
+20% ceiling, and is then compared against Best Overall. If it is not meaningfully better it is
dropped with a reason, because AID-LOG-010 §7 says so explicitly. On a Luxury budget this
happens almost every time — and the screen says why.

**Anchor diversity** is enforced across the four options where inventory allows: once Best
Overall has taken a sofa family, the other three prefer a different one.

### The headroom note
When the best composition lands well under the tier's lower bound, the screen says so:

> **AED 1,370 of your budget is unspent.** Every essential function is covered and no product can
> be meaningfully improved inside your fit, style and colour direction — so AIDOOi leaves the
> budget alone instead of adding furniture or upgrading for the sake of it.

This is AID-LOG-010 §5 and §13 enforced honestly. It is also a live demonstration of the gap in
`docs/05`: LOG-009 has no quality factor, so a perfectly matching Essential-tier product beats a
Premium one, and money goes unspent.

### Demo note
> "Four options, one quality bar. They differ only in what they optimise for after the minimum
> quality is satisfied. And notice what is *not* here — on a Luxury budget the system refuses to
> build a Premium Choice and tells you why. Most builds would have faked a fourth card."

---

## Section 5 · Review, visualize, replace `#/option/<key>`

### What you see
A header with the classification and score. Then a split: the **visualization** on the left with
a *Measured plan / Gallery* toggle, and a **sticky summary** on the right holding the total, the
score breakdown and the two calls to action. Below, the full composition as a grid of product
cards.

### The measured plan
Drawn to scale from the customer's real room dimensions and each product's verified width and
depth. The floor is planked, walls have thickness, there is a door swing arc, and the room is
dimensioned on two sides.

Furniture is placed by zone rules taken from each room standard's fit priority: a sofa holds the
bottom wall, a bed and a desk the top, a dining table the centre with its chairs around it,
wardrobes and bookcases against a side wall rotated 90°, lamps and planters in corners, art and
mirrors on the wall band. The rug follows the anchor — in front of a bed, under a dining table,
under the seating group.

Every shape is a **hotspot**: click it and the Product Card opens. That is the AID-LOG-011
traceability requirement — a visual item must resolve back to its AID and its current AIO.

Fidelity is labelled **Concept**, which the standard permits where product-faithful rendering is
not supportable. The geometry is faithful; the surface rendering is representational.

### The gallery
The same composition as product tiles. Useful when the client wants to look at the furniture
rather than the layout.

### The score breakdown
The four AID-LOG-010 factors with their weights, plus the harmony detail split into style,
colour and material. This is the panel that answers "why is this 91 and not 84?".

### Product cards
Each shows the drawn product, its dimensions, style and colour, its match score, availability,
price, showroom and viewing status. Three actions: **Details**, **Replace**, and — only when the
slot is not essential — **Remove from composition**.

### Replace
Opens a grid of **eligible alternatives only** — same slot, already passed every hard filter and
the 60 threshold. Choosing one runs `applyReplacement()`, which revalidates before committing:

- the replacement's match score must be ≥ 60,
- its fit must be ≥ 50,
- and the **recomposed** composition must still score ≥ 70 with every essential function intact.

If any of those fail the swap is rejected **in the modal, with the reason shown**, and the
composition is left untouched. The standard is explicit that a replacement must never silently
degrade the room or silently change other products.

### Remove
Non-essential products only. The total recalculates immediately, and the revised total is not
required to stay inside the original tier range — AID-LOG-002 §9 says so directly. Essential
products refuse removal and say so on the card.

### Demo note
> "Click the sofa on the plan. That shape knows its AID and its AIO — it is the product, not a
> drawing of a product. Now replace it... and watch: if my choice would have pushed the
> composition below seventy, it tells me and keeps the room as it was."

---

## Section 6 · The Individual Product path

### What you see
A ranked grid of matches for one product type, with the tier's AED range stated above it.

### What happens underneath
`rankIndividual()` skips composition entirely. It builds one slot, scores every offer of that
type and branch, filters to the selected AID-LOG-001 price band, and returns everything that
clears 60 — ranked, with the tie-break order Fit → Style → Availability → Value.

### Worth pointing out
This list is often **short** — four or five products. That is correct behaviour, not thin data:
anything below 60 is excluded, and the standard says to surface limited inventory rather than
lower the threshold.

---

## Section 7 · Multi-module projects — Studio, Full Apartment, Villa

### What you see
A project total, then one card per room module: its area, size class, floor where relevant, its
**allocated** budget, its actual total, a four-image strip and a score. Each card opens into the
normal option screen for that room.

### What happens underneath
`runProject()` turns the path inputs into room modules — an apartment's bedrooms plus living,
dining and an optional office; a villa's modules spread across floors; a studio's sleeping,
living and dining zones derived from the total area and the sleeping setup.

Then it allocates. Each module's **relative cost weight** is the midpoint of its own room-tier
range at the selected tier. The project budget is split in proportion to those weights, and each
module is then run through the full room engine **against its allocated share**, not against the
generic room tier. That is AID-LOG-007 §4: dynamic allocation from actual composition
requirements, never fixed room percentages.

If the sum cannot cover every essential requirement, the screen surfaces a **Budget Constraint**
rather than silently dropping furniture.

### Demo note
> "Eight rooms, one budget, one style direction. The allocation is not twenty percent per room —
> it comes from what each room's composition actually costs at this tier."

---

## Section 8 · The registration gate

### What you see
A short form, reached only when you click **Request viewing** or **Request purchase** as a guest.

### What happens underneath
Guests explore, profile, generate recommendations and replace products freely. Registration is
required **only** at viewing and purchase — AID-LOG-013 — and the pending action is stored so you
return to exactly what you were doing, with the project intact. Register from the viewing button
and the viewing request is created for you on the way back.

### Demo note
> "Nothing before this point asked for an email. That is a deliberate rule in the administration
> standard, and it is also why the funnel works."

---

## Section 9 · Viewing, deposit and attribution `#/viewing`

### What you see
Left: the **viewing plan**, grouped into numbered stops. Right: the **deposit** calculation, the
**viewing pass** with its QR, and the **attribution** trail.

### Stops
Products are grouped by physical partner location, minimising the number of stops. Each stop
shows a confirmation state: a stop whose products are all *On Display* confirms immediately;
anything *Viewable on Request* needs a seller confirmation first, and the viewing sits in
`Awaiting Seller Confirmation` until it arrives. (The demo button simulates that round trip.)

### The deposit
```
base    = Σ current selling price of the selected products
raw     = base × 5%
payable = min(raw, AED 500)
```
The screen shows all three lines, so the cap is visible when it bites. Disposition is spelled out
on screen because it is the customer's main question:

| Outcome | Deposit |
|---|---|
| Attended and bought | credited in full at checkout |
| Attended and bought nothing | refunded in full |
| Did not attend | non-refundable |

### The viewing pass
A Viewing ID and a QR rendered deterministically from it. Attendance is validated from the QR —
in this build, by the two outcome buttons.

### Attribution
`Recommended → Requested → Confirmed → Viewed → Purchased / Not Purchased`, shown as a pill trail
that fills as the state advances. This is the record that makes a partner's direct sale after an
AIDOOi viewing still attributable.

### State machine
`Draft → Awaiting Seller Confirmation → Awaiting Deposit → Confirmed → Completed / No-show / Cancelled`

### Demo note
> "Five stops, five showrooms, one plan, one deposit — capped at five hundred dirhams no matter
> how large the order. This is the part of AIDOOi that a pure e-commerce player cannot copy."

---

## Section 10 · Checkout `#/checkout`

### What you see
Left: **final seller validation**, line by line, with each showroom and a status pill. Right:
**one payment** — order total, viewing deposit credit, amount payable — plus the reservation
state and the 24-hour window.

### What happens underneath
`validateSellers()` re-reads every offer at checkout time and confirms three things per line:
the offer is still active, stock covers the quantity, and **the price has not changed**. A price
change does not silently pass — it is flagged as requiring customer approval.

Only when every line confirms does `createReservation()` open an **Active** reservation with a
24-hour purchase window. The Pay button is disabled otherwise. That is the acceptance gate:
*no capture before all required seller validations*.

On payment, `capturePayment()`:

1. applies any viewing deposit credit,
2. locks a **transaction snapshot** per line — AID, AIO, seller, quantity, unit price, gross line
   amount and **commission rate** — which is never re-read from live data afterwards,
3. splits the cart into one **Master Order** and one **Seller Order** per showroom,
4. converts the reservation to an allocation.

### Demo note
> "Eleven products from five showrooms. The customer sees one cart, one checkout, one payment to
> AIDOOi. The split happens behind the scenes — and the commission rate is frozen at the moment
> of payment, so a later rate change cannot rewrite history."

---

## Section 11 · Orders, fulfilment and issues `#/orders`

### What you see
The Master Order with its status, then one panel per seller order, then a line table: product,
state, settlement state, amount, and the actions available.

### The line state machine
```
Confirmed → Preparing → Ready for Dispatch → Dispatched → Delivered → Receipt Confirmed
```
Advancing is strictly sequential — `advanceLine()` rejects any skip — and an open issue blocks
the transition entirely. Reaching **Receipt Confirmed** flips settlement to **Eligible**.

In MVP, partners report status by telephone and AIDOOi records it (AID-LOG-015). The buttons
here stand in for that operator action. A delivered line with no open issue auto-confirms after
**72 hours**.

### Issues
Seven flags: Delayed, Delivery Failed, Damaged, Missing, Cancellation Requested, Return
Requested, Disputed. Raising one moves that line's settlement to **On Hold**. Resolving it as
*Refunded* makes the line permanently ineligible; resolving it otherwise releases the hold.

Crucially, a finished line is **never** blocked by an unfinished sibling — a delivered sofa
settles even while a delayed lamp is still open.

### Demo note
> "Advance this line to Receipt Confirmed — settlement flips to Eligible. Now report an issue on
> that one — settlement goes On Hold, and only that line. The money for the delivered items is
> not held hostage by the delayed one."

---

## Section 12 · Settlement — the table at the bottom of `#/orders`

### What you see
One row per partner: eligible lines, gross, commission, on hold, net payable.

### The arithmetic
```
net payable = Σ gross line amount (eligible lines)
            − Σ gross × commission rate (from the locked snapshot)
            − refunds and adjustments
```

Only Delivered + Receipt Confirmed (or 72-hour auto-confirmed) lines count. Lines on hold are
shown separately so the number is explainable to a partner rather than just asserted.

---

## Section 13 · Engine console `#/standards`

Not a customer screen. This is the page for the build team and for a technical client.

It shows the live catalogue counts (334 parent products, 601 canonical variants, 851 seller
offers, 6 partners), the two scoring formulas with their weights, the partner register with
commission rates, and — most usefully — **all ten MVP acceptance gates from Master Plan §9,
each evaluated against the current session**.

Run a recommendation, then open this page: the Recommendation gate shows the actual scores from
your run, the Four Options gate shows how many were offered and how many suppressed, and the
Deposit gate shows the live deposit state.

### Demo note
> "This page is for your technical people. Every acceptance gate from section nine of your
> Master Plan, with what this build actually did against it."

---

# Part B — The code, file by file

```
mvp/
├── index.html              Page shell, fonts, header, footer
├── css/aidooi.css          The whole design system as tokens
└── js/
    ├── standards.js        Controlled vocabularies + price intelligence
    ├── paths.js            Paths, size classes, compositions, budgets
    ├── catalogue.js        AIP / AID / AIO records and partners
    ├── engine.js           Scoring and composition logic
    ├── commerce.js         Viewing, checkout, orders, settlement
    ├── art.js              Product illustrations
    ├── ui.js               Brand, icons, the measured plan
    └── app.js              Router, views, actions
```

| File | What lives there | Key exports |
|---|---|---|
| `standards.js` | AID-DATA-007/008/009 vocabularies, the controlled **style and colour compatibility maps**, material compatibility, and the full AID-LOG-001 price matrix (47 keyed bands) | `styleScore`, `colourScore`, `materialPairScore`, `priceRange`, `tierOfPrice`, `TIERS` |
| `paths.js` | The eight paths, their inputs and kinds; size-class bands; **default compositions and preferred fit** for every size of every room; room budget tables; project budget tables | `PATHS`, `sizeClass`, `compositionFor`, `roomBudget`, `projectBudget` |
| `catalogue.js` | Deterministic generation of parent products, canonical variants and seller offers from a type spec; six partner stores; the **eligibility gate** | `candidates`, `eligibleOffers`, `PARTNERS`, `catalogueStats` |
| `engine.js` | AID-LOG-009 scoring, AID-LOG-010 composition scoring, slot allocation, the four objectives, replacement and removal revalidation, the project allocator | `runRecommendation`, `runProject`, `rankIndividual`, `applyReplacement`, `removeItem`, `scoreProduct` |
| `commerce.js` | Stops, deposit, viewing states, seller validation, reservation, payment and order split, line state machine, issues, settlement run | `createViewing`, `depositFor`, `capturePayment`, `advanceLine`, `raiseIssue`, `settlementRun` |
| `art.js` | 32 product renderers driven by the product's own colour, material and proportions, plus the top-down plan glyphs | `productArt`, `planGlyph` |
| `ui.js` | Brand mark, the outline icon family, and `roomPlan()` — zone placement, floor texture, dimension lines, hotspots | `brandMark`, `icon`, `roomPlan` |
| `app.js` | The hash router, all nine views, the modals, and one delegated click handler covering 24 actions | — |

Every file cites the governing standard section in a comment at the point of decision. If a
number looks arbitrary, the citation beside it says where it came from.

---

# Part C — Cross-cutting concerns

## The data model as it appears on screen

```
Parent Product (AIP)  →  Canonical Variant (AID)  →  Seller Offer (AIO)  →  Partner
                                   ↓
Project  →  Recommendation Run  →  Composition  →  Composition Item
                                                        ↓
                                   Viewing Request → Stop → Deposit → Attribution
                                                        ↓
                                   Master Order → Seller Order → Order Line → Settlement
```

Identifiers are visible throughout — on product cards, in the checkout table, in the order lines
— because AID-DATA-005 makes them permanent and meaningless. The engine reads product type and
structured attributes; it never parses an ID.

## State and persistence

Only two things survive a reload: your name and your current project. Recommendation runs hold
live object graphs, so they are rebuilt rather than serialized. Every storage call is wrapped in
`try/catch`, so the app works in a private window with storage blocked. **Reset demo data** in
the footer clears it.

## The design system

`css/aidooi.css` is AID-DATA-015 as tokens: the eight brand colours, the 4/8/16/24/32/48/64
spacing scale, radii, three shadow levels, the serif/sans pairing, and the four responsive
breakpoints. Nothing outside that file hard-codes a brand value, which is why a rebrand is a
one-file change.

Responsive behaviour preserves content priority rather than scaling the desktop page down: the
sticky summary unsticks, the splits collapse, the stepper shows only the current label, and the
navigation sheds secondary links.

---

# Part D — Demo cue card

Five minutes, in order, with the one line to say at each stop.

| Stop | Click | Say |
|---|---|---|
| 1 | Home | "That plan was generated on page load. The engine is running." |
| 2 | Find my best match → Living Room | "One question routes the whole journey." |
| 3 | 5.5 × 4.5 | "24.8 m², classified Medium — by the system, never by the customer." |
| 4 | Scandinavian, Beige, Standard | "Controlled vocabularies. And each budget card carries a real product at that tier." |
| 5 | Generate | "Four options, one quality bar, four objectives." |
| 6 | Read the headroom note | "It tells you when it is leaving your money alone, and why." |
| 7 | View & visualize | "Drawn to scale from verified dimensions against the real room." |
| 8 | Click the sofa on the plan | "Every shape resolves to its AID and its current AIO." |
| 9 | Replace → pick a bad fit | "Rejected, with the reason. It will not quietly degrade the room." |
| 10 | Request viewing | "First time we have asked who you are — that is the standard, not a choice." |
| 11 | Deposit | "Five percent, capped at five hundred. Credited, refunded or forfeited." |
| 12 | Record attendance → checkout | "One cart, five showrooms, one payment to AIDOOi." |
| 13 | Pay | "Commission rate frozen at this moment, per line." |
| 14 | Advance a line to Receipt Confirmed | "Settlement flips to Eligible." |
| 15 | Report an issue on another line | "That line goes On Hold. The others still settle." |
| 16 | Engine | "Every acceptance gate from Master Plan §9, evaluated live." |

### Three things to show that most demos would hide

1. **A Luxury budget** — Premium Choice is suppressed, with a stated reason.
2. **A rejected replacement** — the system refuses and explains.
3. **The headroom note** — the system admits it is not spending your money.

Each one is the product refusing to flatter itself, which is the most convincing thing a
recommendation engine can do in front of a client.
