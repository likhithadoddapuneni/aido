/* ============================================================
   engine.js — AIDOOi Recommendation Engine
   Implements:
     AID-LOG-009  Product Matching & Recommendation Ranking Logic
     AID-LOG-010  Final Recommendation Options Logic
     AID-LOG-001  Product price intelligence (slot allocation)
     AID-LOG-002..008  Composition, fit and budget per path
   Hard requirements decide eligibility. Soft preferences decide
   ranking. A strong soft score can never offset a failed
   mandatory requirement (AID-LOG-009 §14).
   ============================================================ */

import {
  styleScore, colourScore, materialPairScore,
  priceRange, TIERS, tierOfPrice
} from './standards.js';
import {
  sizeClass, compositionFor, roomBudget, area, pathById, nearestCapacity
} from './paths.js';
import { candidates, eligibleOffers, bestOffer, productById, partnerById } from './catalogue.js';

export const MIN_PRODUCT_MATCH = 60;      // AID-LOG-009 §10
export const MIN_COMPOSITION    = 70;     // AID-LOG-010 §15
export const MIN_FIT            = 50;     // AID-LOG-009 §4
export const PREMIUM_STRETCH    = 0.20;   // AID-LOG-010 §7

/* ---------------- AID-LOG-009 §4 — Fit Quality ---------------- */
function fitScore(product, slot, room) {
  const band = slot.w;
  if (!band) return 85;

  /* Hard spatial requirement: an anchor cannot exceed the longest usable
     wall run once circulation is reserved (AID-LOG-002 §2, §10 step 4). */
  if (room && room.longestWallCm) {
    const usable = room.longestWallCm * (slot.role === 'anchor' ? 0.80 : 0.92);
    if (product.width > usable) return 0;                   // reject — fails fit
  }

  const [lo, hi] = band;
  const w = product.width;
  if (w >= lo && w <= hi) return 100;
  const dev = w < lo ? (lo - w) / lo : (w - hi) / hi;
  if (dev <= 0.10) return 85;
  if (dev <= 0.25) return 70;
  if (dev <= 0.40) return 50;
  return 0;
}

/* ---------------- AID-LOG-009 §7 — Budget / Value ---------------- */
function budgetScore(price, allocated) {
  if (!allocated) return 85;
  const r = price / allocated;
  if (r >= 0.85 && r <= 1.05) return 100;   // Ideal Value Zone
  if (r >= 0.70 && r < 0.85) return 90;     // Slightly below target
  if (r > 1.05 && r <= 1.20) return 75;     // Slightly above, manageable
  if (r < 0.70) return 65;                  // Significantly below expected level
  if (r > 1.20 && r <= 1.35) return 50;     // Near maximum tolerable allocation
  return -1;                                // Makes the allocation unworkable → Reject
}

/* ---------------- AID-LOG-009 §9 — Availability Convenience ---------------- */
function availabilityScore(offer) {
  if (!offer || offer.availability === 'Out of Stock') return -1;
  const fast = offer.deliveryDays <= 5;
  if (offer.availability === 'In Stock' && offer.onDisplay && fast) return 100;
  if (offer.availability === 'In Stock' && offer.viewable && fast) return 85;
  if (offer.availability === 'In Stock') return 70;
  return 50;                                 // Low stock / longer delivery
}

/* ---------------- AID-LOG-009 §8 — Practical Match ---------------- */
function practicalScore(product, slot, spec) {
  switch (product.type) {
    case 'Bed':          return product.attrs.bedSize === (spec.bedSize || 'Queen') ? 100 : -1;
    case 'Dining Table': return product.attrs.capacity >= Number(spec.capacity || 4) ? 100 : -1;
    case 'Sofa':         return 100;
    case 'Office Chair': return product.attrs.adjustable ? 100 : 85;
    case 'Desk':         return product.attrs.cableManagement ? 100 : 85;
    default:             return 100;         // no mandatory practical requirement for this slot
  }
}

/** AID-LOG-009 §3 — the weighted AIDOOi Match Score for one offer. */
export function scoreProduct(product, offer, slot, ctx) {
  const fit = fitScore(product, slot, ctx.room);
  const practical = practicalScore(product, slot, ctx.spec);
  const avail = availabilityScore(offer);
  const budget = budgetScore(offer.sellingPrice, slot.allocated);

  const hardFail =
    fit === 0 ? 'Fit' :
    fit < MIN_FIT ? 'Minimum Fit' :
    practical < 0 ? 'Practical requirement' :
    avail < 0 ? 'Availability' :
    budget < 0 ? 'Budget' : null;

  const style  = styleScore(ctx.style, product.primaryStyle, product.secondaryStyle);
  const colour = colourScore(ctx.colour, product.primaryColour, product.secondaryColour);

  const total = hardFail ? 0 : Math.round(
    fit * 0.30 + style * 0.25 + colour * 0.15 + budget * 0.15 + practical * 0.10 + avail * 0.05
  );
  /* Budget-independent quality, used by the "budget exceeds essential needs"
     upgrade sequence in AID-LOG-008 §6: improve product quality, scale/fit and
     material/design match — never add products to consume budget. */
  const quality = hardFail ? 0 : Math.round(
    (fit * 0.30 + style * 0.25 + colour * 0.15 + practical * 0.10 + avail * 0.05) / 0.85
  );

  return {
    productId: product.id, offerId: offer.id,
    fit, style, colour, budget, practical, avail,
    total, quality,
    eligible: !hardFail && total >= MIN_PRODUCT_MATCH,
    rejectedFor: hardFail || (total < MIN_PRODUCT_MATCH ? `Match Score ${total} < ${MIN_PRODUCT_MATCH}` : null)
  };
}

export const classifyMatch = s =>
  s >= 90 ? 'Excellent Match' : s >= 80 ? 'Strong Match' :
  s >= 70 ? 'Good Match'      : s >= 60 ? 'Acceptable Match' : 'Do Not Recommend';

export const classifyComposition = s =>
  s >= 90 ? 'Excellent Composition' : s >= 80 ? 'Strong Composition' :
  s >= 70 ? 'Good Composition' : 'Do Not Recommend';

/* ---------------- Budget allocation across composition slots ----------------
   AID-LOG-007 §4: allocation is derived from each slot's actual composition
   requirement and relative cost weight — not from fixed room percentages. */
function allocate(slots, ceiling, tier) {
  const tierIdx = TIERS.indexOf(tier);
  const weights = slots.map(s => {
    const r = priceRange(s.type, s.branch, tier) ||
              priceRange(s.type, s.branch, TIERS[Math.max(0, tierIdx - 1)]) || [100, 300];
    return ((r[0] + r[1]) / 2) * s.qty;
  });
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  /* Target 92% of the ceiling so replacements and price movement have headroom. */
  const pot = ceiling * 0.92;
  slots.forEach((s, i) => {
    s.allocatedTotal = (weights[i] / sum) * pot;
    s.allocated = s.allocatedTotal / s.qty;
  });
  return slots;
}

/* ---------------- Candidate generation per slot ---------------- */
function slotCandidates(slot, ctx) {
  const out = [];
  for (const p of candidates(slot.type, slot.branch)) {
    for (const o of eligibleOffers(p.id)) {
      const sc = scoreProduct(p, o, slot, ctx);
      out.push({ ...sc, product: p, offer: o });
    }
  }
  /* AID-LOG-009 §11 tie-break: Fit → Style → Availability → Value. */
  out.sort((a, b) =>
    b.total - a.total || b.fit - a.fit || b.style - a.style || b.avail - a.avail || b.budget - a.budget);
  return out;
}

/* ---------------- AID-LOG-010 §11 — Composition Harmony ---------------- */
function harmony(items) {
  if (items.length < 2) return 100;
  let s = 0, c = 0, m = 0, n = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i].product, b = items[j].product;
      s += styleScore(a.primaryStyle, b.primaryStyle, b.secondaryStyle);
      c += colourScore(a.primaryColour, b.primaryColour, b.secondaryColour);
      m += materialPairScore(a.material, b.material);
      n++;
    }
  }
  const style = s / n, colour = c / n, material = m / n;
  return {
    style, colour, material,
    total: style * 0.50 + colour * 0.30 + material * 0.20
  };
}

/* ---------------- AID-LOG-010 §10 — Product Match Quality ---------------- */
function productMatchQuality(items) {
  const g = { anchor: [], core: [], secondary: [] };
  for (const it of items) g[it.slot.role].push(it.total);
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const base = { anchor: 0.50, core: 0.35, secondary: 0.15 };
  const present = Object.keys(base).filter(k => g[k].length);
  const wsum = present.reduce((t, k) => t + base[k], 0) || 1;
  return present.reduce((t, k) => t + avg(g[k]) * (base[k] / wsum), 0);
}

/* ---------------- AID-LOG-010 §12 — Functional Completeness ---------------- */
function completeness(items, slots) {
  const filled = new Set(items.map(i => i.slot.key));
  const essentials = slots.filter(s => s.essential);
  if (essentials.some(s => !filled.has(s.key))) return -1;           // Reject / Rebuild
  const core = slots.filter(s => s.role === 'core');
  const secondary = slots.filter(s => s.role === 'secondary');
  const coreCov = core.length ? core.filter(s => filled.has(s.key)).length / core.length : 1;
  const secCov = secondary.length ? secondary.filter(s => filled.has(s.key)).length / secondary.length : 1;
  if (coreCov === 1 && secCov >= 0.8) return 100;
  if (coreCov === 1 && secCov >= 0.4) return 85;
  if (coreCov >= 0.75) return 70;
  return 60;
}

/* ---------------- AID-LOG-010 §13 — Budget Performance ---------------- */
function budgetPerformance(total, range, ceiling) {
  if (total > ceiling) return -1;                                    // Reject / Rebuild
  const u = total / range[1];
  if (u >= 0.80 && u <= 1.20) return 100;
  if (u >= 0.65) return 85;
  if (u >= 0.45) return 70;
  return 50;                                                         // weak / unbalanced
}

/** AID-LOG-010 §9 — the Composition Score. */
export function scoreComposition(items, slots, range, ceiling) {
  const total = items.reduce((t, i) => t + i.offer.sellingPrice * i.qty, 0);
  const pmq = productMatchQuality(items);
  const h = harmony(items);
  const comp = completeness(items, slots);
  const bp = budgetPerformance(total, range, ceiling);

  if (comp < 0 || bp < 0 || items.some(i => i.total < MIN_PRODUCT_MATCH)) {
    return { valid: false, total, reason: comp < 0 ? 'Essential function incomplete' : bp < 0 ? 'Over budget ceiling' : 'Product below minimum match' };
  }
  const score = Math.round(pmq * 0.40 + h.total * 0.30 + comp * 0.20 + bp * 0.10);
  return {
    valid: score >= MIN_COMPOSITION,
    score, total,
    breakdown: { productMatchQuality: pmq, harmony: h, completeness: comp, budgetPerformance: bp },
    classification: classifyComposition(score),
    reason: score < MIN_COMPOSITION ? `Composition Score ${score} < ${MIN_COMPOSITION}` : null
  };
}

/* ---------------- Objective selectors (AID-LOG-010 §4–7) ---------------- */
const OBJECTIVES = {
  bestOverall: {
    label: 'Best Overall Match',
    blurb: 'The highest-quality complete composition for this space.',
    pick: c => c.total
  },
  bestValue: {
    label: 'Best Value',
    blurb: 'The strongest recommendation quality for every dirham spent.',
    /* Quality per budget spent — not the cheapest composition (§5). */
    pick: (c, slot) => c.total / Math.max(0.45, c.offer.sellingPrice / (slot.allocated || c.offer.sellingPrice))
  },
  bestStyle: {
    label: 'Best Style Match',
    blurb: 'Maximum stylistic and material coherence, fit and budget intact.',
    pick: c => c.style * 0.55 + c.colour * 0.30 + c.total * 0.15
  },
  premium: {
    label: 'Premium Choice',
    blurb: 'A meaningful upgrade within a controlled +20% budget stretch.',
    pick: c => c.total + (TIERS.indexOf(c.product.priceTier) * 4)
  }
};

/* Build one option for a given objective. */
function buildOption(key, slots, ctx, range, ceiling, avoidAnchors) {
  const obj = OBJECTIVES[key];
  const items = [];
  const rejected = [];

  for (const slot of slots) {
    let pool = slot.pool.filter(c => c.eligible);
    if (slot.role === 'anchor' && avoidAnchors && avoidAnchors.size) {
      const diverse = pool.filter(c => !avoidAnchors.has(c.product.parentId));
      if (diverse.length) pool = diverse;                  // §8 Anchor Product diversity
    }
    if (key === 'premium') {
      /* Premium must buy a real upgrade, not just a higher price (§7):
         keep candidates in the upper half of the slot's own allocation. */
      const upper = pool.filter(c => c.offer.sellingPrice >= slot.allocated * 0.85);
      if (upper.length) pool = upper;
    }
    if (!pool.length) { rejected.push(slot.key); continue; }
    const best = pool.reduce((a, b) => (obj.pick(b, slot) > obj.pick(a, slot) ? b : a));
    items.push({ ...best, slot, qty: slot.qty });
  }

  /* --- Budget enforcement, AID-LOG-007 §4 protection order ---
     Preserve Fit → Preserve Essential Furniture → Adjust Product Tiers
     → Reduce Conditional / Secondary Items → Reduce Decor. */
  const totalOf = () => items.reduce((t, i) => t + i.offer.sellingPrice * i.qty, 0);
  const order = ['secondary', 'core'];                      // anchors are never downgraded first
  for (const role of order) {
    if (totalOf() <= ceiling) break;
    for (const it of items.filter(i => i.slot.role === role).sort((a, b) =>
      b.offer.sellingPrice * b.qty - a.offer.sellingPrice * a.qty)) {
      if (totalOf() <= ceiling) break;
      const cheaper = it.slot.pool.filter(c =>
        c.eligible && c.total >= MIN_PRODUCT_MATCH && c.offer.sellingPrice < it.offer.sellingPrice);
      if (cheaper.length) {
        const swap = cheaper.reduce((a, b) => (b.total > a.total ? b : a));
        Object.assign(it, swap);
      }
    }
  }
  /* Still over: remove non-essential secondary items, decor first. */
  const decorTypes = new Set(['Vase', 'Decorative Object', 'Planter', 'Wall Art', 'Mirror', 'Cushion', 'Throw']);
  while (totalOf() > ceiling) {
    const removable = items
      .map((it, idx) => ({ it, idx }))
      .filter(({ it }) => !it.slot.essential && it.slot.role === 'secondary')
      .sort((a, b) => (decorTypes.has(b.it.product.type) - decorTypes.has(a.it.product.type)) ||
                      (b.it.offer.sellingPrice * b.it.qty - a.it.offer.sellingPrice * a.it.qty));
    if (!removable.length) break;
    items.splice(removable[0].idx, 1);
    rejected.push(removable[0].it.slot.key);
  }

  /* --- Budget exceeds essential composition needs, AID-LOG-008 §6 ---
     Improve Product Quality → Scale/Fit → Material/Design Match, by SWAPPING
     products only. Never add products merely to consume available budget, and
     never apply this to Best Value, whose objective is quality per dirham. */
  if (key !== 'bestValue') {
    const floor = ceiling * 0.82;
    for (let pass = 0; pass < 40 && totalOf() < floor; pass++) {
      let best = null;
      for (const it of items) {
        const headroom = ceiling - totalOf();
        for (const c of it.slot.pool) {
          if (!c.eligible || c.quality <= it.quality) continue;
          const delta = (c.offer.sellingPrice - it.offer.sellingPrice) * it.qty;
          if (delta <= 0 || delta > headroom) continue;
          const gain = (c.quality - it.quality) / Math.max(1, delta / it.qty);
          if (!best || gain > best.gain) best = { it, c, gain };
        }
      }
      if (!best) break;
      Object.assign(best.it, best.c);
    }
  }

  const scored = scoreComposition(items, slots, range, ceiling);
  return {
    key, label: obj.label, blurb: obj.blurb,
    items, droppedSlots: rejected, ...scored,
    ceiling
  };
}

/* ---------------- Public: run a recommendation (WF-02) ---------------- */
export function runRecommendation(project) {
  const path = pathById(project.pathId);
  const spec = project.spec || {};
  const tierIdx = TIERS.indexOf(project.tier);

  const roomArea = spec.area != null ? Number(spec.area) : area(spec.length, spec.width);
  const cls = sizeClass(project.pathId, roomArea);
  if (!cls) return { status: 'Failed', reason: 'No room logic for this path', options: [] };

  /* A multi-module project allocates its own range per room module
     (AID-LOG-007 §4); a standalone room uses its tier table. */
  const range = project.budgetOverride || roomBudget(project.pathId, cls, tierIdx);
  const ceilingBase = range[1];

  const room = {
    area: roomArea, cls,
    longestWallCm: Math.max(Number(spec.length) || 0, Number(spec.width) || 0) * 100 ||
                   Math.sqrt(roomArea) * 120
  };

  const ctx = { style: project.style, colour: project.colour, spec, room };

  /* Slot pools are allocation-sensitive: Budget/Value scoring compares each
     offer against its own slot allocation, so the Premium Choice option needs
     its own pass at the stretched ceiling (AID-LOG-010 §7). */
  const prepare = ceiling => {
    const ss = compositionFor(project.pathId, cls, spec).map((x, i) => ({ ...x, key: `${x.type}#${i}` }));
    allocate(ss, ceiling, project.tier);
    for (const x of ss) x.pool = slotCandidates(x, ctx);
    return ss;
  };

  const slots = prepare(ceilingBase);
  const premiumSlots = prepare(ceilingBase * (1 + PREMIUM_STRETCH));

  /* Hard constraint surface: an essential slot with no eligible candidate
     must be reported, never silently dropped (AID-LOG-002 §12). */
  const blockedEssentials = slots.filter(s => s.essential && !s.pool.some(c => c.eligible));
  if (blockedEssentials.length) {
    return {
      status: 'Failed', cls, room, range, slots,
      reason: `No eligible product for essential ${blockedEssentials.map(s => s.type).join(', ')} within this budget and fit envelope.`,
      options: []
    };
  }

  const options = [];
  const usedAnchors = new Set();
  for (const key of ['bestOverall', 'bestValue', 'bestStyle', 'premium']) {
    const isPremium = key === 'premium';
    const ceiling = isPremium ? ceilingBase * (1 + PREMIUM_STRETCH) : ceilingBase;
    const useSlots = isPremium ? premiumSlots : slots;
    const opt = buildOption(key, useSlots, ctx, range, ceiling, key === 'bestOverall' ? null : usedAnchors);
    if (!opt.valid) { opt.suppressed = true; options.push(opt); continue; }
    opt.slots = useSlots;
    const anchor = opt.items.find(i => i.slot.role === 'anchor');
    if (anchor) usedAnchors.add(anchor.product.parentId);
    options.push(opt);
  }

  /* §7 — if Premium brings no meaningful improvement, do not manufacture it. */
  const overall = options.find(o => o.key === 'bestOverall');
  const premium = options.find(o => o.key === 'premium');
  if (overall && premium && premium.valid) {
    const better = premium.score > overall.score + 1 || premium.total > overall.total * 1.05;
    if (!better) { premium.suppressed = true; premium.reason = 'No meaningful premium upgrade available'; }
  }

  const valid = options.filter(o => o.valid && !o.suppressed);
  valid.sort((a, b) => (a.key === 'bestOverall' ? -1 : b.key === 'bestOverall' ? 1 : 0));

  return {
    runId: 'RUN-' + Date.now().toString(36).toUpperCase(),
    status: valid.length ? (valid.length < 4 ? 'Limited Inventory' : 'Completed') : 'Failed',
    cls, room, range, ceiling: ceilingBase, slots,
    options: valid,
    suppressed: options.filter(o => o.suppressed || !o.valid)
  };
}

/* ---------------- WF-03 — replacement revalidation ---------------- */
export function alternativesFor(run, option, item) {
  const slot = option.items.find(i => i.slot.key === item.slot.key).slot;
  return slot.pool
    .filter(c => c.eligible && c.offer.id !== item.offer.id)
    .slice(0, 24);
}

export function applyReplacement(run, option, itemKey, candidate) {
  const idx = option.items.findIndex(i => i.slot.key === itemKey);
  if (idx < 0) return { ok: false, reason: 'Item not in composition' };
  const slot = option.items[idx].slot;

  if (candidate.total < MIN_PRODUCT_MATCH)
    return { ok: false, reason: `Replacement Match Score ${candidate.total} is below ${MIN_PRODUCT_MATCH}` };
  if (candidate.fit < MIN_FIT)
    return { ok: false, reason: 'Replacement fails the fit requirement for this space' };

  const trial = option.items.slice();
  trial[idx] = { ...candidate, slot, qty: slot.qty };
  const scored = scoreComposition(trial, option.slots || run.slots, run.range, option.ceiling);
  if (!scored.valid)
    return { ok: false, reason: scored.reason || `Revised composition score ${scored.score} is below ${MIN_COMPOSITION}` };

  option.items = trial;
  Object.assign(option, scored);
  option.modified = true;
  return { ok: true, score: scored.score };
}

/** Customer removal of a non-essential product; price recalculates (AID-LOG-002 §9). */
export function removeItem(run, option, itemKey) {
  const idx = option.items.findIndex(i => i.slot.key === itemKey);
  if (idx < 0) return { ok: false, reason: 'Not found' };
  if (option.items[idx].slot.essential)
    return { ok: false, reason: 'This product covers an essential function and cannot be removed' };
  const trial = option.items.slice();
  trial.splice(idx, 1);
  const scored = scoreComposition(trial, option.slots || run.slots, run.range, option.ceiling);
  option.items = trial;
  Object.assign(option, scored, { valid: true });   // removal is a customer choice, not a rebuild
  option.modified = true;
  return { ok: true };
}

/* ---------------- AID-SPC-009 — Individual Product path ---------------- */
export function rankIndividual({ type, branch, style, colour, tier }) {
  const range = priceRange(type, branch, tier) || [0, Infinity];
  const slot = { type, branch, w: null, role: 'anchor', qty: 1, allocated: (range[0] + range[1]) / 2, key: type + '#0' };
  const ctx = { style, colour, spec: { capacity: branch, bedSize: branch }, room: null };
  const pool = slotCandidates(slot, ctx)
    .filter(c => c.offer.sellingPrice >= range[0] * 0.9 && c.offer.sellingPrice <= range[1] * 1.1);
  return { range, slot, results: pool.filter(c => c.eligible), rejected: pool.filter(c => !c.eligible) };
}

/* ---------------- AID-LOG-007 / 008 — multi-module projects ---------------- */
export function runProject(project) {
  const path = pathById(project.pathId);
  const mods = path.modules(project.spec);

  /* Relative cost weight per module, from each module's own default
     composition at the selected tier → dynamic budget allocation. */
  const weights = mods.map(m => {
    const a = m.area;
    const cls = sizeClass(m.path, a);
    const r = roomBudget(m.path, cls, TIERS.indexOf(project.tier));
    return { ...m, cls, mid: (r[0] + r[1]) / 2 };
  });
  const sum = weights.reduce((t, m) => t + m.mid, 0) || 1;
  const projectCeiling = Number(project.projectBudget);

  const modules = weights.map(m => {
    const share = (m.mid / sum) * projectCeiling;
    const run = runRecommendation({
      pathId: m.path,
      tier: project.tier,
      style: project.style,
      colour: project.colour,
      /* The allocated share is the module's budget, not the generic room tier. */
      budgetOverride: [share * 0.72, share],
      spec: {
        area: m.area,
        length: Math.sqrt(m.area * 1.35), width: Math.sqrt(m.area / 1.35),
        bedSize: m.bedSize, capacity: m.capacity, users: m.users
      }
    });
    return { ...m, share, run };
  });

  const total = modules.reduce((t, m) => {
    const o = m.run.options && m.run.options[0];
    return t + (o ? o.total : 0);
  }, 0);

  return {
    runId: 'PRJ-' + Date.now().toString(36).toUpperCase(),
    status: modules.every(m => m.run.options && m.run.options.length) ? 'Completed' : 'Limited Inventory',
    projectCeiling, modules, total,
    constraint: total > projectCeiling
      ? 'Budget Constraint: the selected total budget cannot cover every essential room requirement at this tier.'
      : null
  };
}

export { OBJECTIVES };
