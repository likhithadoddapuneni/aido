# 05 — Gaps in the standards, and the decisions taken

Every item below is a place where the 47 standards are silent, ambiguous, or could not be executed
as written. Each records the decision used in `mvp/` so it can be confirmed or overruled.

---

## Confirmed gaps in the source documents

| # | Gap | Where | Decision taken here |
|---|---|---|---|
| 1 | **No villa budget table.** LOG-008 names the five tiers but publishes no numeric ranges, stating budget "is driven by actual room modules… not by bedroom count or number of floors alone" | AID-LOG-008 §5 | The villa target is **summed from its own room modules** at the selected tier, using each room's LOG-002…005 table. Faithful to the stated principle; needs sign-off as the production rule |
| 2 | **`AID-VIS-001` is referenced but does not exist.** LOG-009 §13 and LOG-010 §17 both defer room/project visual rendering to it | LOG-009, LOG-010 | Visualization uses LOG-011's Concept mode, labelled as such. A production decision is needed on whether AID-VIS-001 is in MVP scope at all |
| 3 | **LOG-001 §1 says studio/apartment/villa budget logic "will be defined in AID-LOG-003"**, but LOG-003 is Bedroom logic | AID-LOG-001 §1 | Treated as a drafting error; project budgets come from LOG-006/007/008. Worth correcting in the source |
| 4 | **No craftsmanship or build-quality factor** in the Match Score. Fit, style, colour, budget, practical and availability are all that exist | AID-LOG-009 §3 | Consequence: when a lower-tier product matches perfectly, the engine correctly leaves budget unspent. The prototype surfaces this as a *budget headroom* message rather than inventing spend. If "quality" should influence ranking, LOG-009 needs a new factor |
| 5 | **Style and colour compatibility maps are mandated but not supplied.** LOG-009 §12 requires controlled maps; no map is in the documents | AID-LOG-009 §5–6, §12 | A first-draft map is implemented in `mvp/js/standards.js`. **This needs AIDOOi's own sign-off** — it drives 40% of every product score |
| 6 | **"Available Placement Space" is required for fit but never defined.** LOG-002 §2 says area alone is insufficient | AID-LOG-002 §2 | Approximated as the longest wall run, with 80% usable for anchors and 92% for other products. A real rule (door/window positions, circulation widths) is needed |
| 7 | **Decor placement zones are qualitative.** "Wall zone / console surface / open floor" with no way to count them from the inputs | AID-LOG-002 §5 | Decor is allocated by the size profile and placed into zone buckets. Counting real zones needs the floor-plan input to be parsed, which is optional today |
| 8 | **Premium "+20%" ceiling vs "meaningful improvement"** — no definition of meaningful | AID-LOG-010 §7 | Premium is suppressed unless its composition score exceeds Best Overall by more than 1 point or its total exceeds it by more than 5%. Threshold needs confirming |
| 9 | **"Current Selling Price" staleness is undefined.** Prices may change between recommendation, viewing and checkout | DATA-010, LOG-014 §3 | Validated at checkout; any change requires customer approval; snapshot locked only at successful payment |
| 10 | **No universal return period, by design**, but also no per-partner mechanism described | AID-LOG-015 / WF-07 | Returns are handled per issue, per partner agreement. The `partner` record needs after-sales terms added |
| 11 | **Dining capacity vs table capacity branch.** LOG-001 prices tables at 2/4/6/8/10; LOG-004 lets the customer pick any capacity | LOG-001 §4.3, LOG-004 §3 | Customer capacity rounds **up** to the next priced branch, and chair quantity stays exactly the selected capacity |
| 12 | **Bedroom consistency / repeated-space preference** is "a recommendation modifier, not a budget modifier", with no algorithm | LOG-007 §6, LOG-008 §7 | Collected in the UI, not yet applied to selection. Needs a rule: same parent product, same style family, or same anchor? |
| 13 | **Guest → registered upgrade** must "return to the same action without restarting the project", but no session model is given | LOG-013, WF-04 §1 | Pending action is stored and resumed after registration. A real guest session token is a Phase 1 item |
| 14 | **Telephone fulfilment updates** (LOG-015) have no described capture tool | AID-LOG-015 | The prototype exposes the line state machine directly. Production needs an operator screen with who/when audit |

---

## Interpretation calls (defensible, but worth confirming)

| # | Call | Rationale |
|---|---|---|
| A | **Fit score bands.** Within the preferred width band = 100; within 10% outside = 85; 25% = 70; 40% = 50; beyond = reject | LOG-009 §4 defines the levels verbally but gives no numeric tolerance. Preferred dimensions are explicitly *guidance, not cut-offs* (LOG-002 §2), so a graded band rather than a hard filter is the faithful reading |
| B | **Slot budget allocation.** Each composition slot is allocated a share of 92% of the ceiling, weighted by the AID-LOG-001 tier midpoint for that product type × quantity | LOG-007 §4 requires "relative cost weight → dynamic allocation" and forbids fixed percentages. Tier midpoints are the only cost signal in the documents. The 8% reserve gives replacements headroom |
| C | **Budget Performance utilisation bands.** 80–120% of the range top = 100; 65–80% = 85; 45–65% = 70; below = 50 | LOG-010 §13 names the levels without numbers |
| D | **Composition harmony** is the mean pairwise score across all products in the composition | LOG-010 §11 says harmony evaluates products "against each other, not only against the customer", which implies pairwise |
| E | **Availability convenience** treats delivery ≤ 5 days as "Ready/Fast" | LOG-009 §9 uses the phrase without a threshold |
| F | **Upgrade pass when budget exceeds need** — swaps products for higher-quality equivalents, never adds products | Direct implementation of LOG-008 §6's "If budget exceeds essential composition needs" sequence, bounded by "must not add unnecessary products merely to consume available budget" |

---

## Open questions for AIDOOi

1. Is **AID-VIS-001** in MVP scope, or is LOG-011 Concept visualization sufficient to launch?
2. Who owns and signs off the **style and colour compatibility maps**? They need a version and a
   review cadence before launch.
3. What is the **villa budget rule** — module sum (as implemented) or a published table like LOG-007's?
4. Should **product quality/craftsmanship** become a Match Score factor? Without it, a perfectly
   matching Essential-tier product will always beat a Premium one, and budget routinely goes unspent.
5. What exactly does **bedroom consistency** mean in selection terms?
6. What are the **after-sales terms per partner**, given there is deliberately no universal return period?
7. Is the **AED 500 deposit cap** per viewing request, per stop, or per customer per period? The
   standard says "5% of selected viewing products, maximum AED 500" — read here as per request.
