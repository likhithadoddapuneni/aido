# 02 — The 47 standards, digested

Everything below is drawn from the supplied PDFs. Where a standard carries numbers the engine needs,
the numbers are reproduced here so the build team does not have to reopen a PDF to find them.
**The PDFs remain authoritative.** This is a working digest, not a replacement.

---

## A. The mental model

```
AIDOOi PLATFORM
├── BUYERS                          └── SELLERS
│    "I need to furnish my living room"   ├── Products
│              ↓                          ├── Prices
│     AIDOOi AI / Recommendation          ├── Stock
│              ↓                          ├── Viewing
│   Suitable products + complete           └── Delivery
│          combinations
│              ↓
│      View → Select → Buy
```

One entry question — **"What are you furnishing?"** — routes into one of eight paths. Everything
after that is only what the chosen path needs.

---

## B. AID-DATA — product data & design (15 standards)

| Code | Standard | What the build must take from it |
|---|---|---|
| 001 | Product Name | Use the official model name; otherwise a short standardised descriptive name. The name is **not** a container for colour, price or seller data |
| 002 | Parent Product & Variant | One model family = one Parent; each physical variant is its own canonical product |
| 003 | Brand Data | Controlled brand vocabulary |
| 004 | Classification & Taxonomy | Main Category › Category › Product Type |
| 005 | Identification & Variant Coding | `AIP-00000001` parent · `AID-00000001` canonical variant · `AIO-00000001` seller offer. 8-digit zero-padded global sequences, never reused, never changed. **IDs carry no meaning** — AI must never infer product characteristics from an ID |
| 006 | Dimensions | Width / depth / height in cm, used for fit |
| 007 | Colour | Primary + Secondary from a controlled family list; Specific Colour (e.g. "Cognac") preserved separately. Families: White, Black, Grey, Beige, Brown, Green, Blue, Red, Orange, Yellow, Pink, Purple, Gold, Silver, Brass, Bronze, Natural, Multicolour |
| 008 | Material | Material Family / Specific Material |
| 009 | Style | Style Family → Standard Style → Alias. Standard Style is the stored value; aliases normalise seller language without creating duplicates |
| 010 | Pricing | **Current Selling Price** is the basis for everything. Original Price is secondary and never drives tier classification |
| 011 | Availability & Inventory | In Stock / Low Stock / Out of Stock, on-display flag, delivery lead time |
| 012 | Images & Media | Product imagery rules |
| 013 | Description | Product description rules |
| 014 | Data Status & Data Quality | Incomplete → Ready for Review → Verified/Active → Inactive. **Only Verified + Active records enter recommendation** |
| 015 | UI Design System | See section F |

---

## C. AID-CAT — category standards (8)

`001` Seating · `002` Sofas · `003` Tables · `004` Beds · `005` Storage & Casegoods ·
`006` Lighting · `007` Rugs & Soft Furnishings · `008` Decor & Accessories.

Each defines the **mandatory practical attributes** for its category. Mandatory attributes decide
eligibility; optional attributes only improve ranking, and only when relevant. More features never
automatically mean a better match, and this logic must not generate extra customer questions.

---

## D. AID-SPC — the eight customer paths (9)

`AID-SPC-001` classifies the project; `002`–`009` define each path's inputs.

| Path | Required inputs | Conditional | Always |
|---|---|---|---|
| Living Room | Length, Width | — | Style, Colour, Budget tier; optional photo/floor plan |
| Bedroom | Length, Width | **Bed Size** | ″ |
| Dining Room | Length, Width | **Dining Capacity** | ″ |
| Home Office | Length, Width | **Workspace Users** | ″ |
| Studio Apartment | Total Area | **Sleeping Setup** | ″ |
| Full Apartment | Bedrooms + modules | Bedroom consistency, office yes/no | Overall Style/Colour, total budget |
| Villa | Floors, modules per floor | Repeated-space preference | ″ |
| Individual Product | Product Category | Category practical attributes | Style, Colour, Budget |

**Lean input principle:** no path-specific question is added unless testing shows it materially
improves recommendation quality. The customer never selects the size classification — the system
derives it from the dimensions.

---

## E. AID-LOG — system logic (15)

### LOG-001 · Product Price Range Standard

Five shared tier names — **Essential, Value, Standard, Premium, Luxury** — with AED ranges that vary
by product type and, where it materially changes the market, by capacity/size.
Routing: `Product Type → Capacity/Size (if needed) → Budget Tier → Style → Colour → Recommendation`.
Customer-facing budget cards show tier name + numeric AED range + a representative image.
Full matrix is reproduced in `mvp/js/standards.js` (`PRICE_MATRIX`).

### LOG-002…008 · Room and project composition

Each room standard converts dimensions into: **Size Class → Default Composition → Preferred Fit →
Room Budget Range**.

| Standard | Size classification (m²) |
|---|---|
| LOG-002 Living Room | Compact <12 · Small 12–20 · Medium 20–30 · Large 30–45 · XL 45+ |
| LOG-003 Bedroom | Compact <9 · Small 9–14 · Medium 14–20 · Large 20–30 · XL 30+ |
| LOG-004 Dining Room | Compact <8 · Small 8–12 · Medium 12–18 · Large 18–25 · XL 25+ |
| LOG-005 Home Office | Compact <6 · Small 6–10 · Medium 10–15 · Large 15–22 · XL 22+ |
| LOG-006 Studio | Compact <25 · Small 25–35 · Medium 35–45 · Large 45–60 · XL 60+ |

Shared rules that matter more than the tables:

- Default composition is **not** a hard constraint, and preferred dimensions are **not** cut-off filters.
- Room area alone never decides fit — shape and available placement space must also be considered.
- The room budget tier is a target for the whole composition; individual products may sit in
  different product-level tiers.
- Decor quantity comes from the size profile, but decor **type** follows real placement zones
  (wall / surface / floor), not a fixed shopping list.
- Extra floor area never justifies extra furniture on its own.
- Fit and circulation beat budget preference. A product that does not fit is never recommended.
- Removing a product recalculates the total immediately, and the revised total is not required to
  stay inside the original tier range.

Per-path anchors: Bedroom fits the **bed first** (Bed → Circulation → Bedside → Wardrobe → Chest →
Rug/Lighting → Seating → Decor). Dining fits **table → chairs → pull-out → circulation** and surfaces
a Fit Constraint rather than silently reducing capacity. Home Office fits **required workspaces →
chairs → circulation → storage → task lighting → secondary zone → decor**, and never reduces the
workspace count to protect secondary furniture.

Projects (LOG-007 apartment, LOG-008 villa) allocate dynamically:
`Total Budget → Included Modules → Room Requirements → Relative Cost Weight → Allocation`.
Never fixed room percentages. Protection order when constrained:
**Preserve Fit → Preserve Essential Furniture → Adjust Product Tiers → Reduce Conditional/Secondary
→ Reduce Decor → surface a Budget Constraint.**
When budget *exceeds* need: **Improve Product Quality → Scale/Fit → Material/Design Match → Enhance
Secondary → Enhance Decor** — but never add products merely to consume budget.

### LOG-009 · Product Matching & Ranking — the scoring core

Hard requirements decide **eligibility**. Soft preferences decide **ranking**.

| Factor | Weight | 100 | 85 | 70 | 50 | Reject |
|---|---|---|---|---|---|---|
| Fit Quality | 30% | Ideal | Very good | Acceptable | Weak | Fails spatial/circulation/functional requirement |
| Style Match | 25% | Primary style = customer | Secondary = customer | Strong compatible | Partially compatible | Clear conflict |
| Colour Match | 15% | Primary matches | Secondary matches | Compatible family | Neutral/harmonizable | Clear conflict |
| Budget / Value | 15% | Ideal value zone | 90 slightly below | 75 slightly above | Near max tolerable | Makes budget unworkable |
| Practical | 10% | All satisfied | Minor difference | Core satisfied | Minimum function | Mandatory requirement unmet |
| Availability | 5% | In stock + on display + fast | In stock + viewable + fast | In stock | Longer delivery | Unavailable |

- **Minimum Match Score = 60/100.** Below that the product is never recommended — not even to fill a slot.
- **Minimum Fit = 50.** Below that it is not a candidate at all.
- Classification: 90+ Excellent · 80–89 Strong · 70–79 Good · 60–69 Acceptable.
- Tie-break: **Fit → Style → Availability → Value**.
- Style and colour compatibility must come from **controlled maps** maintained by AIDOOi, never from
  unconstrained model interpretation. This is what makes ranking consistent, explainable and testable.
- Lowest price and biggest discount are never automatically rewarded.

### LOG-010 · Final Recommendation Options

Four options, **one shared quality foundation**, four optimization objectives:

| Option | Objective |
|---|---|
| **Best Overall Match** | Default. Highest-quality complete composition. Priority: Fit & Function → Match Quality → Harmony → Budget → Availability |
| **Best Value** | Maximum quality per dirham — *not* the cheapest. Savings may be reallocated, but never spent just to use up budget |
| **Best Style Match** | Maximum style/colour/material coherence after fit and function are satisfied, inside the budget ceiling |
| **Premium Choice** | A meaningful upgrade within **+20%** of the budget ceiling. Higher price alone is not an upgrade; if no meaningful improvement exists, **do not create the option** |

Composition Score:

| Factor | Weight | Detail |
|---|---|---|
| Product Match Quality | 40% | Anchor 50% / Core supporting 35% / Secondary-decorative 15%, normalised when a role group is absent |
| Composition Harmony | 30% | Style 50% / Colour 30% / Material 20%, evaluated **between products**, not just against the customer |
| Functional Completeness | 20% | 100 essentials + supporting · 85 essentials + some supporting · 70 intentionally lean · reject if an essential function is missing |
| Budget Performance | 10% | How intelligently budget is allocated. Over the ceiling = reject |

- **Minimum Composition Score = 70/100**, plus three hard rules that cannot be averaged away:
  no product below Match 60; no incomplete essential function; no fit/hard requirement violated.
- Options should be meaningfully distinct — prefer **anchor product diversity** — but diversity never
  overrides quality.

### LOG-011 · Visualization

Product-faithful where supportable, **Concept** where it is not, and labelled either way. Every visual
item resolves back to its AID and current AIO so the customer can open the Product Card and replace it.
Replacement refreshes the visualization and must never silently change other products.

### LOG-012 Rev 2 · Viewing, deposit & attribution

- Products are grouped into **Viewing Stops** by physical location, minimising stops.
- Seller confirmation required; stale "On Display" status must be reconfirmed.
- **Deposit = 5% of the selected products' Current Selling Price, maximum AED 500.**
- Outcomes: Completed + purchase → **100% credited** · Completed + no purchase → **100% refunded** ·
  No-show → **non-refundable**.
- Attribution trail: Recommended → Requested → Confirmed → Viewed → Purchased / Not Purchased.
  A direct partner sale remains subject to attribution terms.
- States: `Draft → Awaiting Seller Confirmation → Awaiting Deposit → Confirmed → Completed / No-show / Cancelled`.

### LOG-013 · User, partner & product administration

Guests may explore freely. **Registration is required at viewing and purchase**, and the customer
returns to the same action without restarting the project. Partners are activated manually
(`Requested → Under Review → Approved/Agreement Pending → Active/Inactive`). In MVP there is
**no seller portal and no direct partner product editing** — AIDOOi Admin creates, standardises and
verifies all product data.

### LOG-014 · Checkout, payment & settlement

- Final Seller Validation on every line **before** capture: stock, quantity, final selling price.
- All lines confirmed → reserve quantities and open a **24-hour purchase window** from the last
  required seller confirmation.
- **One Cart → One Checkout → One Payment to AIDOOi.** No partial successful multi-seller checkout.
- Successful payment locks the transaction snapshot: AID, AIO, Seller, Quantity, Unit Price,
  Gross Line Amount, **Commission Rate**.
- Master Order splits into Seller Orders and Order Lines.
- Settlement: `Gross Eligible Sales − Commission − Refunds/Adjustments = Net Settlement Payable`,
  using the locked line-level commission snapshot.

### LOG-015 · Fulfilment, status & exceptions

Line flow: `Confirmed → Preparing → Ready for Dispatch → Dispatched → Delivered → Receipt Confirmed
→ Settlement Eligible`. Partners report status **by telephone** in MVP and AIDOOi records it.
Receipt auto-confirms **72 hours** after Delivered when no issue is open. Completed lines are never
blocked from settlement by unfinished sibling lines.

Issue flags: Delayed · Delivery Failed · Damaged · Missing · Cancellation Requested · Return
Requested · Disputed. An open issue puts settlement **On Hold**. A refund before settlement prevents
eligibility; a refund after settlement creates a future adjustment. There is **no invented universal
return period** — AIDOOi governs and tracks, the partner executes after-sales.

---

## F. AID-DATA-015 · UI Design System

Design direction: *warm, premium, calm, intelligent and interior-led.*

| Token | Value | Use |
|---|---|---|
| Primary Navy | `#12345B` | Primary buttons, key headings, active states, navigation emphasis |
| Accent Beige | `#B7A78F` | Restrained highlights and warm brand accents — never the dominant action colour |
| Background Ivory | `#FAF8F5` | Primary page background |
| Surface Warm Neutral | `#F0ECE7` | Cards and soft panels |
| Primary Text | `#1F2937` | Body text |
| Secondary Text | `#6B7280` | Captions and metadata |
| Border / Divider | `#E5E1DB` | Subtle separators |
| White | `#FFFFFF` | Card and input surfaces |

Spacing scale **4 / 8 / 16 / 24 / 32 / 48 / 64 px**. Editorial serif for display headings, clean
sans-serif for everything functional — decorative type must never reduce the readability of prices,
dimensions or availability. Breakpoints: desktop 1280+, laptop 1024–1279, tablet 768–1023,
mobile 320–767; responsive behaviour must **preserve content priority**, not shrink the desktop page.

Brand: wordmark **AiDOOi** with both lowercase `i` characters constructed identically; rounded
inverted-arch symbol above a four-square window motif, with **no** eyebrow/roof mark above the squares;
tagline *"Your intelligent interior assistant"* used as a secondary element.

Final principle: *"AIDOOi should feel intelligent and premium without feeling technical, cold or
visually complicated."*
