# 03 — System specification

This is the artifact both the Master Plan and the 8 Core Workflows name as "next":

> "Convert these workflows into the **Master Data Dictionary & System Specification**: entities,
> tables, fields, foreign keys, controlled values, state transitions, audit events and API-facing
> objects."

Field types below are indicative (PostgreSQL). `→` marks a foreign key.

---

## 1. Architecture

| Layer | Responsibility | Governing standards |
|---|---|---|
| Customer Frontend (Web/PWA) | Profiling, recommendation, visualization, viewing, purchase | SPC-001–009, LOG-010–015, DATA-015 |
| Product Data Service | Canonical products, variants, offers, taxonomy, attributes, media | DATA-001–014, CAT-001–008 |
| Recommendation Service | Eligibility, scoring, composition, four options | LOG-001–010 |
| Visualization | Product-faithful or concept representation | LOG-011 |
| Viewing & Attribution | Stops, deposit, QR, attendance, attribution | LOG-012 Rev 2 |
| Commerce | Validation, reservation, payment, order split, settlement | LOG-014 |
| Operations / Admin | Partner activation, product admin, fulfilment, issues | LOG-013, LOG-015 |

**Frontend vs backend split (Master Plan §6).** The frontend shows the eight choices and only the
relevant questions, collects minimum dimensions, presents up to four options, runs one cart/checkout/
payment and shows simple grouped order status. Everything else — path resolution, fit rules, scoring,
composition, seller validation, reservation, order splitting, settlement — is backend.

---

## 2. Product domain

### `parent_product` (AIP)
| Field | Type | Notes |
|---|---|---|
| `id` | char(12) PK | `AIP-00000001`, global sequence, never reused |
| `model_name` | text | AID-DATA-001 |
| `brand_id` | → `brand.id` | AID-DATA-003 |

### `product` (AID) — the canonical physical variant
| Field | Type | Notes |
|---|---|---|
| `id` | char(12) PK | `AID-00000001` |
| `parent_id` | → `parent_product.id` | AID-DATA-002 |
| `name` | text | AID-DATA-001; never contains colour, price or seller |
| `main_category`, `category`, `product_type` | text | AID-DATA-004, controlled |
| `width_cm`, `depth_cm`, `height_cm` | int | AID-DATA-006 |
| `primary_colour`, `secondary_colour` | enum | AID-DATA-007 controlled families |
| `specific_colour` | text | e.g. "Cognac" — never replaces the family |
| `material_family`, `specific_material` | text | AID-DATA-008 |
| `primary_style`, `secondary_style` | enum | AID-DATA-009 standard styles |
| `attributes` | jsonb | Category practical attributes, AID-CAT-001–008 |
| `data_status` | enum | `Incomplete / Ready for Review / Verified` — AID-DATA-014 |
| `lifecycle` | enum | `Active / Inactive` |

> **Hard rule (AID-DATA-005):** IDs identify records, they do not describe them. The recommendation
> engine must read `product_type` and structured attributes, never parse an ID.

### `seller_offer` (AIO)
| Field | Type | Notes |
|---|---|---|
| `id` | char(12) PK | `AIO-00000001` |
| `product_id` | → `product.id` | one AID → many AIO |
| `partner_id` | → `partner.id` | |
| `seller_sku` | text | stored exactly as supplied |
| `selling_price` | numeric | **Current Selling Price** — the basis for everything (DATA-010) |
| `original_price` | numeric null | secondary display only |
| `availability` | enum | `In Stock / Low Stock / Out of Stock` (DATA-011) |
| `stock_qty` | int | |
| `viewing_status` | enum | `On Display / Viewable on Request / Not Viewable` |
| `viewing_confirmed_at` | timestamptz | staleness drives reconfirmation (LOG-012 §4) |
| `delivery_days` | int | |
| `commission_rate` | numeric | snapshotted at payment, never read live afterwards |
| `offer_status` | enum | `Active / Inactive` |

**Eligibility gate:** a product may enter recommendation only when
`data_status = Verified AND lifecycle = Active AND offer_status = Active AND availability <> 'Out of Stock' AND stock_qty > 0`.

### `partner`, `partner_location`
`partner.status`: `Requested → Under Review → Approved/Agreement Pending → Active → Inactive`.
Activation is manual (LOG-013). No seller portal in MVP.

---

## 3. Customer & project domain

### `customer`
`guest_session_id` (uuid) upgrades to a registered `customer` at viewing or purchase **without
restarting the project** (LOG-013, WF-04 §1, WF-05 §1).

### `project`
| Field | Notes |
|---|---|
| `path_id` | one of the eight SPC paths |
| `spec` jsonb | length, width, total area, bed size, dining capacity, workspace users, sleeping setup, modules |
| `style_preference`, `colour_preference` | controlled values or `assisted` |
| `budget_tier` | Essential / Value / Standard / Premium / Luxury |
| `size_class` | **system-derived**, never customer-entered |
| `state` | `Draft → In Progress → Ready for Recommendation` |
| `media` | optional photo / floor plan; absence must never block the path |

### `project_module` (apartment / villa / studio only)
`room_path`, `label`, `area`, `floor`, `bed_size`, `capacity`, `users`, `allocated_budget`.

---

## 4. Recommendation domain

### `recommendation_run`
`project_id`, `state` (`Processing → Completed / Limited Inventory / Failed`), `size_class`,
`budget_range_low`, `budget_range_high`, `created_at`.

### `candidate_score` — one row per (slot, AID, AIO) evaluated
`fit`, `style`, `colour`, `budget`, `practical`, `availability`, `total`, `eligible`,
`rejected_reason`. Persisting rejections is what makes a recommendation explainable and testable.

### `composition` / `composition_item`
`objective` (`best_overall / best_value / best_style / premium`), `score`,
`product_match_quality`, `harmony_style`, `harmony_colour`, `harmony_material`,
`functional_completeness`, `budget_performance`, `total_price`, `state` (`Valid / Rebuild / Rejected`).
Items carry `slot_key`, `role` (`anchor / core / secondary`), `essential`, `quantity`,
`product_id`, `offer_id`, `unit_price`.

### `visualization`
`composition_id`, `fidelity` (`Product-Faithful / Concept`), `state`
(`Current / Refresh Required`), and a hotspot map `{ shape_id → (product_id, offer_id) }`.

---

## 5. Viewing domain

### `viewing_request`
`state`: `Draft → Awaiting Seller Confirmation → Awaiting Deposit → Confirmed → Completed / No-show / Cancelled`.
Carries `qr_token`, `scheduled_at`, `customer_id`, `project_id`.

### `viewing_stop` → `viewing_product`
Stops group by `partner_location_id`, minimising stop count.
`confirmation_state`: `Pending / Confirmed / Declined`.

### `viewing_deposit`
```
amount = MIN(0.05 × Σ(selected offer selling_price), 500)      -- AED
state:  Pending → Paid → Credited | Refunded | Non-refundable
```
| Outcome | Deposit |
|---|---|
| Completed + purchase | 100% credited to the order |
| Completed + no purchase | 100% refunded |
| No-show | Non-refundable |

### `attribution`
`stage`: `Recommended → Requested → Confirmed → Viewed → Purchased / Not Purchased`, append-only
history. A direct partner sale after an AIDOOi viewing remains attributable.

---

## 6. Commerce domain

### `purchase_request` / `reservation`
`validation_state`: `Validation Pending → Validated / Rebuild Required`.
`reservation.state`: `Active → Converted / Released / Expired`, `expires_at = last_seller_confirmation + 24h`.

### `payment`
`state`: `Pending → Successful / Failed / Refunded`. One payment per checkout, to AIDOOi.
**No capture before every required seller validation. No partial multi-seller success.**

### `master_order` → `seller_order` → `order_line`
`order_line.snapshot` is **locked at successful payment** and never re-read from live data:

```json
{ "product_id": "AID-00000012", "offer_id": "AIO-00000018", "seller_id": "PRT-003",
  "quantity": 1, "unit_price": 2205.00, "gross_line_amount": 2205.00,
  "commission_rate": 0.13 }
```

`order_line.state`: `Confirmed → Preparing → Ready for Dispatch → Dispatched → Delivered →
Receipt Confirmed`, plus terminal `Cancelled / Refunded`.
`settlement_state`: `Not Eligible → Eligible → Included → Paid / Adjusted`, with `On Hold` while an
issue is open.

Receipt auto-confirms 72 h after `Delivered` when no issue is open.
Master status derives from its lines; a finished line is never blocked by an unfinished sibling.

### `issue`
`flag` ∈ {Delayed, Delivery Failed, Damaged, Missing, Cancellation Requested, Return Requested,
Disputed}; `state`: `Open → Partner Handling → Resolved / Refunded / Rejected`.
Opening an issue moves the affected line's settlement to **On Hold**.

### `settlement_run`
Per partner, per month:
```
net_payable = Σ gross_line_amount(eligible lines)
            − Σ gross_line_amount × commission_rate(snapshot)
            − refunds / adjustments
```

---

## 7. Audit

`audit_event(entity_type, entity_id, from_state, to_state, actor, reason, at)` for every state
transition listed above, plus price and commission snapshots and the full issue history
(DATA-014; LOG-012–015).

---

## 8. API surface (indicative)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/projects` | Create a project session, resolve the SPC path |
| `PATCH` | `/projects/{id}` | Collect path inputs; returns derived size class and budget ranges |
| `POST` | `/projects/{id}/recommend` | Run WF-02; returns up to four compositions with scores |
| `GET` | `/compositions/{id}/alternatives?slot=` | Eligible replacements for one slot |
| `POST` | `/compositions/{id}/replace` | Revalidate and apply a replacement |
| `DELETE` | `/compositions/{id}/items/{slot}` | Remove a non-essential product, recalculate total |
| `POST` | `/viewings` | Create stops, request seller confirmations, quote the deposit |
| `POST` | `/viewings/{id}/deposit` | Capture the deposit; issue Viewing ID + QR |
| `POST` | `/viewings/{id}/outcome` | Completed / No-show; settle deposit disposition |
| `POST` | `/checkout/validate` | Final seller validation; open the 24-hour window |
| `POST` | `/checkout/pay` | One payment; lock snapshots; split into orders |
| `GET` | `/orders/{id}` | Customer-facing grouped status |
| `POST` | `/admin/order-lines/{id}/state` | Record telephone-confirmed fulfilment status |
| `POST` | `/admin/order-lines/{id}/issues` | Raise / resolve an issue |
| `GET` | `/admin/settlements?month=` | Monthly settlement run |

---

## 9. Acceptance gates to test against (Master Plan §9)

| Gate | Condition |
|---|---|
| Product Data | Only Verified/Active AIDs and eligible AIOs enter recommendation |
| Recommendation | No hard requirement failure; Product Match ≥ 60; Composition ≥ 70 |
| Fit | Fit/function cannot be overridden by style, colour, discount or the Premium objective |
| Four Options | Valid and meaningfully differentiated where inventory permits; no artificial weak option |
| Visualization | Recommended purchasable products stay traceable and recognizably represented |
| Viewing | Every recommended product is physically viewable; confirmed viewing uses a valid location |
| Deposit | 5% capped at AED 500; completed/no purchase = full refund; purchase = full credit; no-show = non-refundable |
| Payment | No capture before all seller validations; no fulfilment before complete successful payment |
| Orders | Master Order splits correctly with locked transaction snapshots |
| Settlement | Only delivered + receipt-confirmed (or eligible auto-confirmed) lines become settlement eligible |
