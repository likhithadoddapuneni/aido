/* ============================================================
   app.js — AIDOOi MVP customer journey
   Covers WF-01 … WF-08 of "AIDOOi MVP - 8 Core Workflows Rev 1".
   Frontend responsibilities only (Master Plan §6): show the eight
   choices, collect the minimum inputs, present up to four options,
   one cart / one checkout / one payment, simple grouped order status.
   ============================================================ */

import { STYLES, COLOURS, TIERS, TIER_BLURB, fmtAED, priceRange, tierOfPrice } from './standards.js';
import { PATHS, pathById, sizeClass, area, roomBudget, projectBudget, BED_W } from './paths.js';
import { catalogueStats, PARTNERS, partnerById, candidates } from './catalogue.js';
import {
  runRecommendation, runProject, rankIndividual, alternativesFor, applyReplacement,
  removeItem, classifyMatch, MIN_PRODUCT_MATCH, MIN_COMPOSITION, PREMIUM_STRETCH
} from './engine.js';
import * as C from './commerce.js';
import { brandMark, icon, productArt, roomPlan, esc } from './ui.js';

/* ---------------- State ---------------- */
const S = {
  customer: null,
  project: null,       // { pathId, spec, style, colour, tier, projectBudget }
  run: null,           // recommendation run (room paths)
  projectRun: null,    // multi-module run (studio / apartment / villa)
  individual: null,
  optionKey: null,
  vizMode: 'plan',     // 'plan' | 'gallery'
  viewing: null,
  reservation: null,
  order: null,
  orders: [],
  pendingAction: null  // resumed after registration (WF-04 §1 / WF-05 §1)
};
const app = () => document.getElementById('app');
const currentOption = () => S.run && S.run.options.find(o => o.key === S.optionKey);

/* Product types whose price and fit branch on capacity / size (AID-LOG-001 §4). */
const BRANCH_OPTS = {
  'Sofa': ['2', '3', '4', '5'],
  'Dining Table': ['2', '4', '6', '8', '10'],
  'Bed': ['Single', 'Queen', 'King', 'Super King'],
  'Wardrobe': ['Small', 'Medium', 'Large'],
  'Rug': ['Small', 'Medium', 'Large', 'Extra Large']
};
const INDIVIDUAL_TYPES = ['Sofa', 'Accent Chair', 'Coffee Table', 'Dining Table', 'Bed',
  'Wardrobe', 'TV Unit', 'Rug', 'Floor Lamp', 'Mirror', 'Desk', 'Office Chair'];
/* The product that leads each path, used for representative budget imagery. */
const PATH_ANCHOR = {
  livingRoom: 'Sofa', bedroom: 'Bed', diningRoom: 'Dining Table', homeOffice: 'Desk',
  studio: 'Sofa', fullApartment: 'Sofa', villa: 'Sofa'
};

/* ---------------- Router ---------------- */
const routes = {};
const route = (p, fn) => (routes[p] = fn);
function go(hash) {
  /* Setting an unchanged hash fires no hashchange, so render explicitly. */
  if (location.hash === hash) render(); else location.hash = hash;
}
function render() {
  const raw = (location.hash || '#/').slice(1);
  const [path, ...rest] = raw.split('/').filter(Boolean);
  const view = routes[path || 'home'] || routes.home;
  app().innerHTML = view(rest);
  window.scrollTo(0, 0);
  document.querySelectorAll('.nav a').forEach(a =>
    a.classList.toggle('on', a.getAttribute('href') === '#/' + (path || '')));
}
window.addEventListener('hashchange', render);

/* ---------------- Presentation helpers ---------------- */
const pill = (t, k = '') => `<span class="pill ${k}">${esc(t)}</span>`;
const std  = c => `<span class="std">${esc(c)}</span>`;
const money = (n, cls = '') => `<span class="price ${cls}"><span class="cur">AED</span>${fmtAED(n)}</span>`;
const tile = (p, cls = '') => `<div class="tile ${cls}">${productArt(p)}</div>`;

function stepper(active) {
  const steps = ['Profile', 'Recommendations', 'Review', 'Viewing', 'Checkout', 'Orders'];
  return `<div class="steps">` + steps.map((s, i) =>
    `<div class="s ${i === active ? 'on' : i < active ? 'done' : ''}">
       <span class="n">${i < active ? '✓' : i + 1}</span><span>${s}</span></div>` +
    (i < steps.length - 1 ? '<span class="sep"></span>' : '')).join('') + `</div>`;
}

function matchBars(c) {
  return [['Fit quality', c.fit, 30], ['Style match', c.style, 25], ['Colour match', c.colour, 15],
          ['Budget / value', c.budget, 15], ['Practical match', c.practical, 10], ['Availability', c.avail, 5]]
    .map(([l, v, w]) => `<div class="kv"><span>${l} <small>${w}%</small></span>
      <span class="bar"><i style="width:${Math.max(0, v)}%"></i></span>
      <span>${v < 0 ? '—' : v}</span></div>`).join('');
}

function scoreBars(o) {
  const b = o.breakdown;
  return [['Product match quality', b.productMatchQuality, 40],
          ['Composition harmony', b.harmony.total, 30],
          ['Functional completeness', b.completeness, 20],
          ['Budget performance', b.budgetPerformance, 10]]
    .map(([l, v, w]) => `<div class="kv"><span>${l} <small>${w}%</small></span>
      <span class="bar"><i style="width:${Math.round(v)}%"></i></span>
      <span>${Math.round(v)}</span></div>`).join('');
}

/** A real catalogue product that represents a type at a tier (AID-LOG-001 §5).
    The size branch is held constant so the cards differ by quality, not scale. */
const REP_BRANCH = { 'Sofa': '3', 'Bed': 'Queen', 'Dining Table': '6', 'Wardrobe': 'Medium', 'Rug': 'Large' };
function repProduct(type, tier) {
  const pool = candidates(type, REP_BRANCH[type] ?? null);
  const whole = pool.length ? pool : candidates(type);
  return whole.find(p => p.priceTier === tier) || whole.find(p => p.priceTier === 'Standard') || whole[0];
}

/* ============================================================
   Home
   ============================================================ */
let heroCache = null;
function heroPlan() {
  if (!heroCache) {
    const r = runRecommendation({ pathId: 'livingRoom', tier: 'Standard', style: 'scandinavian',
      colour: 'beige', spec: { length: 5.4, width: 4.2 } });
    heroCache = r.options.length
      ? roomPlan(r.options[0], { area: r.room.area, lengthM: 5.4, widthM: 4.2 }).svg
      : '';
  }
  return heroCache;
}

route('home', () => `
<section class="hero wrap">
  <div class="split">
    <div>
      <div class="eyebrow">Your intelligent interior assistant</div>
      <h1 class="display d1">Tell us the room.<br>We will furnish it<br>properly.</h1>
      <p class="lead">AIDOOi measures your space, learns your style and budget, and builds complete
      furnishing options from products that are genuinely in stock — then lets you see them in person
      and buy them all in one checkout.</p>
      <div class="row" style="margin-top:var(--s5)">
        <a class="btn btn-primary btn-lg" href="#/paths">Find my best match</a>
        <a class="btn btn-ghost btn-lg" href="#/standards">How the engine decides</a>
      </div>
      <div class="grid g3" style="margin-top:var(--s6);gap:var(--s4)">
        ${[[catalogueStats().products, 'verified products'],
           [catalogueStats().offers, 'live seller offers'],
           [catalogueStats().partners, 'partner showrooms']].map(([v, l]) =>
          `<div><div class="display d3">${v}</div><div class="meta">${l}</div></div>`).join('')}
      </div>
    </div>
    <div class="heroart">${heroPlan()}</div>
  </div>
</section>

<section class="section-sm wrap">
  <div class="grid g4" style="gap:var(--s5)">
    ${[['ruler', 'Measured, not guessed', 'Real dimensions in, a size classification out. Fit and circulation are checked before anything is recommended.'],
       ['sparkle', 'Four complete options', 'Best Overall, Best Value, Best Style Match and Premium Choice — one quality bar, four different objectives.'],
       ['eye', 'See it before you buy', 'Every recommended product is physically viewable. 5% deposit, capped at AED 500, credited or refunded in full.'],
       ['bag', 'One cart, many sellers', 'A single payment to AIDOOi. We split the order across showrooms behind the scenes.']
      ].map(([ic, t, d]) => `
      <div class="feature"><span class="ic">${icon(ic)}</span>
        <div><h4>${t}</h4><p>${d}</p></div></div>`).join('')}
  </div>
</section>

<section class="section wrap">
  <div class="row between" style="margin-bottom:var(--s4)">
    <div>
      <div class="eyebrow">In the catalogue</div>
      <h2 class="display d2" style="margin:0">Real products, real stock, real showrooms</h2>
    </div>
    <a class="btn btn-secondary" href="#/paths">Start furnishing</a>
  </div>
  <div class="grid g5">
    ${['Sofa', 'Bed', 'Dining Table', 'Floor Lamp', 'Rug'].map(t => {
      const p = repProduct(t, 'Standard');
      return `<div class="pcard">${tile(p)}
        <div class="body"><div class="nm">${esc(p.name)}</div>
        <div class="sub">${esc(p.primaryStyle)} · ${esc(p.material)}</div></div></div>`;
    }).join('')}
  </div>
</section>`);

/* ============================================================
   WF-01 — Path selection (AID-SPC-001)
   ============================================================ */
route('paths', () => `
<section class="section wrap">
  ${stepper(0)}
  <div class="eyebrow">Step 1 · AID-SPC-001</div>
  <h1 class="display d2">What are you furnishing?</h1>
  <p class="lead" style="max-width:620px">One question routes you into the right path.
  Everything after this is only what that path actually needs.</p>
  <div class="grid g4" style="margin-top:var(--s5)">
    ${PATHS.map(p => `
      <button class="choice" data-act="pick-path" data-id="${p.id}">
        <span class="ic">${icon(p.icon)}</span>
        <span class="t">${p.label}</span>
        <span class="d">${p.blurb}</span>
        <span class="d" style="margin-top:10px">${std(p.spc + ' · ' + p.log)}</span>
      </button>`).join('')}
  </div>
</section>`);

/* ============================================================
   WF-01 — Profiling (AID-SPC-002…009)
   ============================================================ */
route('profile', () => {
  const p = pathById(S.project?.pathId);
  if (!p) return redirect('#/paths');
  const sp = S.project.spec;

  const num = (k, label, hint, val, unit = 'm', step = '0.1') => `
    <label class="field"><span>${label}</span><span class="inline-unit">
      <input type="number" step="${step}" min="0" data-spec="${k}" value="${val ?? ''}" placeholder="${hint}">
      <span class="u">${unit}</span></span></label>`;

  const chips = (k, label, opts, val, note = '') => `
    <div class="field"><span class="lbl">${label}</span>
      <div class="row tight">${opts.map(o =>
        `<button class="choice chip" data-spec-set="${k}" data-val="${o}" aria-pressed="${String(val) === String(o)}">
           <span class="t">${o}</span></button>`).join('')}</div>
      ${note ? `<small style="display:block;margin-top:10px">${note}</small>` : ''}</div>`;

  let inputs = '';
  if (p.inputs.includes('dimensions')) {
    inputs += `<div class="grid g2">${num('length', 'Room length', '5.5', sp.length)}${num('width', 'Room width', '4.2', sp.width)}</div>`;
    const a = area(sp.length, sp.width);
    if (a > 0) inputs += `<div class="note" style="margin-bottom:var(--s4)">
      <strong>${a.toFixed(1)} m²</strong> → size classification <strong>${sizeClass(p.id, a)}</strong>.
      <br><small>You never choose the size class — AIDOOi derives it from your measurements ${std(p.log + ' §3')}.</small></div>`;
  }
  if (p.inputs.includes('bedSize'))  inputs += chips('bedSize', 'Bed size', ['Single', 'Queen', 'King', 'Super King'], sp.bedSize, 'The bed anchors the room; everything else is fitted around it (AID-LOG-003 §4).');
  if (p.inputs.includes('capacity')) inputs += chips('capacity', 'Dining capacity', [2, 4, 6, 8, 10], sp.capacity, 'Table size and chair quantity are derived from this (AID-LOG-004 §3).');
  if (p.inputs.includes('users'))    inputs += chips('users', 'Workspace users', [1, 2, 3], sp.users, 'One appropriate office chair per workspace user (AID-LOG-005 §3).');
  if (p.inputs.includes('totalArea'))inputs += num('totalArea', 'Total area', '38', sp.totalArea, 'm²', '1');
  if (p.inputs.includes('sleepingSetup')) inputs += chips('sleepingSetup', 'Sleeping setup', ['Single Bed', 'Queen Bed', 'King Bed', 'Sofa Bed'], sp.sleepingSetup);
  if (p.inputs.includes('bedrooms')) inputs += chips('bedrooms', 'Bedrooms', [1, 2, 3, 4], sp.bedrooms);
  if (p.inputs.includes('floors'))   inputs += chips('floors', 'Floors', [1, 2, 3], sp.floors);
  if (p.inputs.includes('livingArea')) inputs += num('livingArea', 'Living room area', '26', sp.livingArea, 'm²', '1');
  if (p.inputs.includes('diningCapacity')) inputs += chips('diningCapacity', 'Dining capacity', [4, 6, 8, 10], sp.diningCapacity);
  if (p.inputs.includes('officeYesNo')) inputs += chips('officeYesNo', 'Include a home office?', ['Yes', 'No'], sp.officeYesNo);
  if (p.inputs.includes('consistency')) inputs += chips('consistency', 'Repeat the same products in similar rooms?', ['Yes', 'No'], sp.consistency,
    'A preference only — it never overrides fit, capacity or availability.');
  if (p.inputs.includes('productType')) {
    inputs += `<label class="field"><span>Product type</span>
      <select data-spec="productType">${INDIVIDUAL_TYPES.map(t =>
        `<option ${sp.productType === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
    const bo = BRANCH_OPTS[sp.productType];
    if (bo) inputs += chips('branch', 'Size / capacity', bo, sp.branch, 'AID-LOG-001 §4 prices this branch separately.');
  }
  if (p.inputs.includes('media')) {
    inputs += `<label class="field"><span>Room photo or floor plan <span style="color:var(--text-3);font-weight:400">— optional</span></span>
      <input type="text" data-spec="media" value="${esc(sp.media || '')}" placeholder="Paste a file name or link">
      <small style="display:block;margin-top:8px">Extra context only. Leaving it empty never blocks your recommendation.</small></label>`;
  }

  const styleBlock = `
    <div class="field"><span class="lbl">Style preference ${std('AID-DATA-009')}</span>
      <div class="grid g2" style="gap:10px">
        ${[{ id: 'assisted', label: 'Let AIDOOi decide' }, ...STYLES].map(s => `
          <button class="choice chip" style="width:100%;text-align:center" data-spec-set="style" data-val="${s.id}"
            aria-pressed="${S.project.style === s.id}"><span class="t">${s.label}</span></button>`).join('')}
      </div></div>`;

  const colourBlock = `
    <div class="field" style="margin-bottom:0"><span class="lbl">Colour direction ${std('AID-DATA-007')}</span>
      <div class="grid g2" style="gap:10px">
        ${[{ id: 'assisted', label: 'Let AIDOOi decide', hex: '#FFFFFF' }, ...COLOURS.slice(0, 11)].map(c => `
          <button class="choice chip" data-spec-set="colour" data-val="${c.id}" aria-pressed="${S.project.colour === c.id}">
            <span class="t"><span class="swatch" style="background:${c.hex === 'linear' ? 'linear-gradient(90deg,#B7A78F,#6B7F63,#3B5A7A)' : c.hex}"></span>${c.label}</span></button>`).join('')}
      </div></div>`;

  /* Budget — five cards, each with tier name, numeric AED range and a
     representative product image for that type and tier (AID-LOG-001 §5). */
  let budgetBlock = '';
  const budgetCards = (ranges, anchorType, refLabel) => `
    <div class="field" style="margin-bottom:0"><span class="lbl">Budget ${std(refLabel)}</span>
      <div class="grid g5">
        ${TIERS.map((t, i) => {
          const r = ranges(i);
          const rep = repProduct(anchorType, t);
          return `<button class="choice" style="padding:10px" data-spec-set="tier" data-val="${t}" aria-pressed="${S.project.tier === t}">
            ${rep ? tile(rep, 'wide') : ''}
            <span style="display:block;padding:12px 6px 4px">
              <span class="t">${t}</span>
              <span class="d" style="font-size:14.5px;color:var(--navy);font-weight:600;margin:6px 0">AED ${i === 4 ? fmtAED(r[0]) + '+' : fmtAED(r[0]) + '–' + fmtAED(r[1])}</span>
              <span class="d">${TIER_BLURB[t]}</span></span></button>`;
        }).join('')}
      </div>
      <small style="display:block;margin-top:12px">A target for the complete composition, not a sum you have to spend.</small></div>`;

  if (p.kind === 'room') {
    const a = area(sp.length, sp.width);
    const cls = a > 0 ? sizeClass(p.id, a) : null;
    budgetBlock = cls
      ? budgetCards(i => roomBudget(p.id, cls, i), PATH_ANCHOR[p.id], p.log + ' §budget')
      : `<div class="note">Enter the room dimensions first — the budget ranges follow from the derived size class.</div>`;
  } else if (p.kind === 'project') {
    budgetBlock = projectBudget(p.id, 0, sp)
      ? budgetCards(i => projectBudget(p.id, i, sp), PATH_ANCHOR[p.id],
          p.id === 'villa' ? 'AID-LOG-008 §5' : p.log + ' §budget') +
        `<small style="display:block;margin-top:10px">${p.id === 'villa'
          ? 'The villa target is summed from its actual room modules — AID-LOG-008 publishes no bedroom-count table, because villa budget follows composition, not floors.'
          : 'The base range covers the standard modules; a home office is added as a modifier.'}
          The total is then allocated across rooms by relative cost weight, never fixed percentages ${std('AID-LOG-007 §4')}.</small>`
      : `<div class="note">Complete the project inputs above to see the budget ranges.</div>`;
  } else {
    budgetBlock = budgetCards(i => priceRange(sp.productType || 'Sofa', sp.branch || null, TIERS[i]) || [0, 0],
      sp.productType || 'Sofa', 'AID-LOG-001 §5');
  }

  const ready = profileReady();
  return `
<section class="section wrap">
  ${stepper(0)}
  <div class="row between" style="margin-bottom:var(--s5)">
    <div>
      <div class="eyebrow">${p.spc}</div>
      <h1 class="display d2" style="margin-bottom:6px">${p.label}</h1>
      <p class="meta" style="margin:0">${p.blurb}</p>
    </div>
    <a class="btn btn-ghost btn-sm" href="#/paths">Change path</a>
  </div>

  <div class="split">
    <div class="card pad-lg">${inputs}</div>
    <div class="card pad-lg">${styleBlock}${colourBlock}</div>
  </div>
  <div class="card pad-lg" style="margin-top:var(--s4)">${budgetBlock}</div>

  <div class="row" style="margin-top:var(--s5)">
    <button class="btn btn-primary btn-lg" data-act="run" ${ready ? '' : 'disabled'}>Generate my recommendations</button>
    ${ready ? '' : '<span class="meta">Complete the required inputs to continue.</span>'}
  </div>
</section>`;
});

function profileReady() {
  const p = pathById(S.project?.pathId);
  if (!p || !S.project.tier) return false;
  const sp = S.project.spec;
  if (p.kind === 'room') return area(sp.length, sp.width) > 0 &&
    (!p.inputs.includes('bedSize') || sp.bedSize) &&
    (!p.inputs.includes('capacity') || sp.capacity) &&
    (!p.inputs.includes('users') || sp.users);
  if (p.kind === 'project') return !!projectBudget(p.id, 0, sp) &&
    (!p.inputs.includes('bedrooms') || sp.bedrooms) &&
    (!p.inputs.includes('totalArea') || sp.totalArea);
  return !!sp.productType;
}

/* ============================================================
   WF-02 — Recommendations (AID-LOG-009 / 010)
   ============================================================ */
route('recommendations', () => {
  const p = pathById(S.project?.pathId);
  if (!p) return redirect('#/paths');
  if (p.kind === 'product') return individualView();
  if (p.kind === 'project') return projectView();

  const r = S.run;
  if (!r) return redirect('#/profile');
  if (r.status === 'Failed') return `
    <section class="section wrap">${stepper(1)}
      <div class="note err"><strong>Constraint surfaced.</strong><br>${esc(r.reason)}
      <br><small>AIDOOi surfaces the constraint instead of lowering recommendation quality ${std('AID-LOG-009 §10')}.</small></div>
      <a class="btn btn-secondary" style="margin-top:var(--s4)" href="#/profile">Adjust my inputs</a></section>`;

  return `
<section class="section wrap">
  ${stepper(1)}
  <div class="row between" style="margin-bottom:var(--s5)">
    <div>
      <div class="eyebrow">${r.runId} · ${r.status}</div>
      <h1 class="display d2" style="margin-bottom:8px">${r.options.length} complete option${r.options.length === 1 ? '' : 's'} for your ${p.label.toLowerCase()}</h1>
      <p class="meta" style="margin:0;max-width:720px">${r.room.area.toFixed(1)} m² · ${r.cls} ·
      target AED ${fmtAED(r.range[0])}–${fmtAED(r.range[1])}. Every option passes composition ≥ ${MIN_COMPOSITION}
      with no product below match ${MIN_PRODUCT_MATCH}.</p>
    </div>
    <a class="btn btn-ghost btn-sm" href="#/profile">Change inputs</a>
  </div>

  <div class="grid g2">${r.options.map((o, i) => optionCard(o, i === 0)).join('')}</div>
  ${budgetHeadroomNote(r)}
  ${r.suppressed.length ? `<div class="note" style="margin-top:var(--s4)">
    <strong>Not offered:</strong> ${r.suppressed.map(o => `${o.label} — ${esc(o.reason || 'did not meet the minimum composition quality')}`).join('; ')}.
    <br><small>AIDOOi does not manufacture an artificial option to fill a slot ${std('AID-LOG-010 §7, §8')}.</small></div>` : ''}
</section>`;
});

/** AID-LOG-010 §5/§13: say when the budget exceeds what the room needs. */
function budgetHeadroomNote(r) {
  const best = r.options.find(o => o.key === 'bestOverall');
  if (!best) return '';
  const headroom = r.range[0] - best.total;
  if (headroom <= r.range[0] * 0.1) return '';
  return `<div class="note" style="margin-top:var(--s4)">
    <strong>AED ${fmtAED(headroom)} of your budget is unspent.</strong>
    Every essential function is covered and no product can be meaningfully improved inside your fit, style and
    colour direction — so AIDOOi leaves the budget alone instead of adding furniture or upgrading for the sake of it
    ${std('AID-LOG-010 §5, §13')}. Premium Choice shows what a deliberate upgrade looks like.</div>`;
}

function optionCard(o, primary) {
  const anchor = o.items.find(i => i.slot.role === 'anchor') || o.items[0];
  const others = o.items.filter(i => i !== anchor).slice(0, 2);
  return `
  <div class="card optcard ${primary ? 'primary' : ''}">
    <div class="strip">
      <div class="tile">${productArt(anchor.product)}
        ${primary ? `<span class="tile-badge">${pill('Default', 'navy')}</span>` : ''}</div>
      ${others.map(i => `<div class="tile">${productArt(i.product)}</div>`).join('')}
    </div>
    <div class="row between" style="align-items:center">
      <div>
        <div class="objective">${o.label}</div>
        <p class="meta" style="margin:6px 0 0;max-width:34ch">${o.blurb}</p>
      </div>
      <div class="score">${o.score}<small>SCORE</small></div>
    </div>
    <div class="row between" style="align-items:baseline">
      ${money(o.total)}
      <span class="meta">${o.items.length} products · ${o.classification}</span>
    </div>
    <div class="row tight">
      <button class="btn btn-primary btn-sm" data-act="open-option" data-key="${o.key}">View &amp; visualize</button>
      <button class="btn btn-ghost btn-sm" data-act="why" data-key="${o.key}">Why this option?</button>
    </div>
  </div>`;
}

/* ============================================================
   WF-03 — Review, visualization & replacement
   ============================================================ */
route('option', rest => {
  if (!S.run) return redirect('#/paths');
  S.optionKey = rest[0] || S.optionKey;
  const o = currentOption();
  if (!o) return redirect('#/recommendations');

  const lengthM = Number(S.project.spec.length) || Math.sqrt(S.run.room.area * 1.35);
  const plan = roomPlan(o, { area: S.run.room.area, lengthM, widthM: S.run.room.area / lengthM });

  const gallery = `<div class="pgrid" style="padding:4px">
    ${o.items.map(it => `<div class="tile sq">${productArt(it.product)}</div>`).join('')}</div>`;

  return `
<section class="section wrap">
  ${stepper(2)}
  <div class="row between" style="margin-bottom:var(--s5)">
    <div>
      <div class="eyebrow">${S.run.runId} · ${o.label}${o.modified ? ' · modified' : ''}</div>
      <h1 class="display d2" style="margin-bottom:6px">${o.classification}</h1>
      <p class="meta" style="margin:0">${o.blurb}</p>
    </div>
    <a class="btn btn-ghost btn-sm" href="#/recommendations">All options</a>
  </div>

  <div class="split">
    <div>
      <div class="row between" style="margin-bottom:var(--s3);align-items:center">
        <div class="seg">
          <button data-act="viz" data-mode="plan" aria-pressed="${S.vizMode === 'plan'}">Measured plan</button>
          <button data-act="viz" data-mode="gallery" aria-pressed="${S.vizMode === 'gallery'}">Gallery</button>
        </div>
        ${pill(plan.fidelity + ' visualization', 'beige')}
      </div>
      <div class="viz">${S.vizMode === 'plan' ? plan.svg : gallery}</div>
      <p class="meta" style="margin-top:12px">${esc(plan.note)} ${std('AID-LOG-011')}</p>
    </div>

    <div class="sticky">
      <div class="card pad-lg">
        <div class="row between" style="align-items:center;margin-bottom:var(--s3)">
          <div><div class="eyebrow" style="margin:0">Composition total</div>${money(o.total, 'lg')}</div>
          <div class="score">${o.score}<small>SCORE</small></div>
        </div>
        <p class="meta" style="margin:0 0 var(--s4)">${o.items.length} products · ceiling AED ${fmtAED(o.ceiling)}${o.key === 'premium' ? ` incl. the approved +${PREMIUM_STRETCH * 100}% stretch` : ''}.
        Removing a product recalculates the total immediately.</p>
        ${scoreBars(o)}
        <small style="display:block;margin-top:4px">Harmony detail — style ${Math.round(o.breakdown.harmony.style)},
        colour ${Math.round(o.breakdown.harmony.colour)}, material ${Math.round(o.breakdown.harmony.material)}.</small>
        <div class="row" style="margin-top:var(--s4)">
          <button class="btn btn-primary btn-block" data-act="start-viewing">Request viewing</button>
          <button class="btn btn-secondary btn-block" data-act="start-purchase">Request purchase</button>
        </div>
        <small style="display:block;margin-top:12px">Registration is required at viewing and purchase — you come
        straight back here with your project intact ${std('AID-LOG-013')}.</small>
      </div>
    </div>
  </div>

  <div class="row between" style="margin:var(--s6) 0 var(--s4)">
    <h2 class="display d3" style="margin:0">The composition</h2>
    <span class="meta">${o.items.length} products from ${new Set(o.items.map(i => i.offer.partnerId)).size} showrooms</span>
  </div>
  <div class="pgrid">${o.items.map(productCard).join('')}</div>
  ${o.droppedSlots.length ? `<p class="meta" style="margin-top:var(--s4)">Not included:
    ${o.droppedSlots.map(d => esc(d.split('#')[0])).join(', ')} — left out to protect fit and essential furniture inside your budget.</p>` : ''}
</section>`;
});

function productCard(it) {
  const p = it.product, of = it.offer, partner = partnerById[of.partnerId];
  return `
  <div class="pcard" data-item-row="${esc(it.slot.key)}">
    ${tile(p)}
    <div class="body">
      <div class="nm">${esc(p.name)}${it.qty > 1 ? ` × ${it.qty}` : ''}</div>
      <div class="sub">${esc(p.width)}×${esc(p.depth)} cm · ${esc(p.primaryStyle)} · ${esc(p.primaryColour)}</div>
      <div class="row tight" style="margin-top:10px">
        ${pill('Match ' + it.total, it.total >= 80 ? 'ok' : '')}
        ${pill(of.availability, of.availability === 'In Stock' ? 'ok' : 'warn')}
      </div>
      <div class="foot">
        ${money(of.sellingPrice * it.qty, 'sm')}
        ${of.originalPrice ? `<span class="price-was">AED ${fmtAED(of.originalPrice * it.qty)}</span>` : ''}
      </div>
      <div class="meta" style="font-size:12px">${esc(partner.name)} · ${esc(of.viewingStatus)}</div>
      <div class="acts">
        <button class="btn btn-ghost btn-sm" data-act="card" data-item="${esc(it.slot.key)}">Details</button>
        <button class="btn btn-ghost btn-sm" data-act="replace" data-item="${esc(it.slot.key)}">Replace</button>
      </div>
      ${it.slot.essential ? '<small style="display:block;margin-top:6px">Essential — cannot be removed</small>'
        : `<button class="btn btn-text" data-act="remove" data-item="${esc(it.slot.key)}">Remove from composition</button>`}
    </div>
  </div>`;
}

/* ============================================================
   Individual product path (AID-SPC-009)
   ============================================================ */
function individualView() {
  const res = S.individual;
  if (!res) return redirect('#/profile');
  return `
<section class="section wrap">
  ${stepper(1)}
  <div class="eyebrow">AID-SPC-009 · AID-LOG-001 · AID-LOG-009</div>
  <h1 class="display d2">${res.results.length} ranked ${esc(S.project.spec.productType)} match${res.results.length === 1 ? '' : 'es'}</h1>
  <p class="meta" style="max-width:640px">Tier range AED ${fmtAED(res.range[0])}–${fmtAED(res.range[1])}.
  Products scoring below ${MIN_PRODUCT_MATCH} are never shown, even when that leaves a short list.</p>
  <div class="pgrid" style="margin-top:var(--s5)">
    ${res.results.slice(0, 16).map(c => `
      <div class="pcard">${tile(c.product)}
        <div class="body">
          <div class="nm">${esc(c.product.name)}</div>
          <div class="sub">${esc(c.product.primaryStyle)} · ${esc(c.product.primaryColour)} · ${esc(c.product.width)} cm</div>
          <div class="foot">${money(c.offer.sellingPrice, 'sm')}${pill(`${c.total}`, c.total >= 80 ? 'ok' : '')}</div>
          <div class="meta" style="font-size:12px">${esc(classifyMatch(c.total))} · ${esc(partnerById[c.offer.partnerId].name)}</div>
        </div></div>`).join('')}
  </div>
  ${res.results.length === 0 ? `<div class="note err" style="margin-top:var(--s4)">No product in this tier satisfies the
    mandatory requirements. AIDOOi surfaces the limited inventory rather than lowering the threshold.</div>` : ''}
</section>`;
}

/* ============================================================
   Multi-module project paths (AID-LOG-006 / 007 / 008)
   ============================================================ */
function projectView() {
  const pr = S.projectRun;
  if (!pr) return redirect('#/profile');
  return `
<section class="section wrap">
  ${stepper(1)}
  <div class="eyebrow">${pr.runId} · ${pr.status}</div>
  <h1 class="display d2">${pr.modules.length} coordinated room modules</h1>
  <p class="meta" style="max-width:720px">Total project budget AED ${fmtAED(pr.projectCeiling)}, allocated by relative
  cost weight rather than fixed percentages ${std('AID-LOG-007 §4')}.</p>
  ${pr.constraint ? `<div class="note err" style="margin-top:var(--s4)">${esc(pr.constraint)}</div>` : ''}

  <div class="card pad-lg" style="margin-top:var(--s4)">
    <div class="row between" style="align-items:center">
      <div><div class="eyebrow" style="margin:0">Project total</div>
      <span class="meta">${pr.modules.reduce((t, m) => t + ((m.run.options && m.run.options[0]) ? m.run.options[0].items.length : 0), 0)} products across ${pr.modules.length} rooms</span></div>
      ${money(pr.total, 'lg')}
    </div>
  </div>

  <div class="grid g2" style="margin-top:var(--s4)">
    ${pr.modules.map((m, i) => {
      const o = m.run.options && m.run.options[0];
      return `<div class="card">
        <div class="row between" style="align-items:flex-start;margin-bottom:var(--s3)">
          <div><h3 style="margin:0 0 4px">${esc(m.label)}</h3>
            <div class="meta">${m.area.toFixed(1)} m² · ${esc(m.cls)}${m.floor ? ' · ' + esc(m.floor) : ''}${m.bedSize ? ' · ' + esc(m.bedSize) : ''}</div></div>
          <div style="text-align:right"><div class="meta">Allocated</div><strong class="num">AED ${fmtAED(m.share)}</strong></div>
        </div>
        ${o ? `
          <div class="strip" style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">
            ${o.items.slice(0, 4).map(it => `<div class="tile sq">${productArt(it.product)}</div>`).join('')}
          </div>
          <div class="row between" style="margin-top:var(--s3);align-items:baseline">
            ${money(o.total)}<span class="meta">${o.items.length} products · score ${o.score}</span></div>
          <button class="btn btn-secondary btn-sm btn-block" style="margin-top:var(--s3)" data-act="open-module" data-mod="${i}">Open this room</button>
        ` : `<div class="note err">${esc(m.run.reason || 'No valid composition for this module.')}</div>`}
      </div>`;
    }).join('')}
  </div>
</section>`;
}

/* ============================================================
   WF-04 — Viewing, deposit & attribution
   ============================================================ */
route('viewing', () => {
  if (!S.customer) return registerView('viewing');
  const v = S.viewing;
  if (!v) return redirect('#/recommendations');

  return `
<section class="section wrap">
  ${stepper(3)}
  <div class="eyebrow">${v.id} · ${v.state} ${std('AID-LOG-012 Rev 2')}</div>
  <h1 class="display d2">See it before you buy</h1>

  <div class="split" style="margin-top:var(--s5)">
    <div class="card pad-lg">
      <h3>Viewing plan — ${v.stops.length} stop${v.stops.length === 1 ? '' : 's'}</h3>
      <p class="meta">Products are grouped by physical location so you travel as little as possible ${std('§3')}.</p>
      ${v.stops.map(s => `
        <div class="card soft" style="margin-top:var(--s3)">
          <div class="row between" style="align-items:center">
            <div><strong>Stop ${s.stopNo} · ${esc(s.partner.name)}</strong>
              <div class="meta">${esc(s.location)}</div></div>
            ${pill(s.confirmation, s.confirmation === 'Confirmed' ? 'ok' : 'warn')}
          </div>
          <div style="margin-top:var(--s3)">${s.products.map(it => `
            <div class="lineitem" style="padding:8px 0">
              <div class="tile" style="width:52px;flex:0 0 52px">${productArt(it.product)}</div>
              <div class="info"><div class="nm" style="font-size:14px">${esc(it.product.name)}</div>
              <div class="meta">${esc(it.offer.viewingStatus)}</div></div>
              <span class="num meta">AED ${fmtAED(it.offer.sellingPrice)}</span>
            </div>`).join('')}</div>
        </div>`).join('')}
      ${v.state === 'Awaiting Seller Confirmation'
        ? `<button class="btn btn-primary" style="margin-top:var(--s4)" data-act="confirm-sellers">Simulate seller confirmations</button>` : ''}
    </div>

    <div class="sticky">
      <div class="card pad-lg">
        <h3>Deposit ${std('§5')}</h3>
        <table class="data">
          <tr><td>Selected products</td><td class="num">AED ${fmtAED(v.deposit.base)}</td></tr>
          <tr><td>5% commitment deposit</td><td class="num">AED ${fmtAED(v.deposit.raw)}</td></tr>
          <tr><td><strong>Payable${v.deposit.capped ? ' (capped at AED 500)' : ''}</strong></td>
              <td class="num"><strong>AED ${fmtAED(v.deposit.amount)}</strong></td></tr>
          <tr><td>State</td><td class="num">${pill(v.deposit.state)}</td></tr>
        </table>
        <div class="note" style="margin-top:var(--s3)">Attend and buy → credited in full. Attend and buy nothing →
        refunded in full. Do not attend → non-refundable ${std('§10–12')}.</div>
        ${v.state === 'Awaiting Deposit' ? `<button class="btn btn-primary btn-block" style="margin-top:var(--s4)" data-act="pay-deposit">Pay AED ${fmtAED(v.deposit.amount)} deposit</button>` : ''}
      </div>

      ${['Confirmed', 'Completed', 'No-show'].includes(v.state) ? `
      <div class="card pad-lg" style="margin-top:var(--s3)">
        <h3>Your viewing pass</h3>
        <div class="row" style="gap:var(--s4);align-items:center;flex-wrap:nowrap">
          ${qrSvg(v.qr)}
          <div><div class="meta">Viewing ID</div><strong>${esc(v.id)}</strong>
            <div class="meta" style="margin-top:8px">Show this at each stop. Attendance is validated from the QR ${std('§8')}.</div></div>
        </div>
        ${v.state === 'Confirmed' ? `
          <div class="row tight" style="margin-top:var(--s4)">
            <button class="btn btn-primary btn-sm" data-act="viewing-outcome" data-val="Completed">Record attendance</button>
            <button class="btn btn-ghost btn-sm" data-act="viewing-outcome" data-val="No-show">Record no-show</button>
          </div>` : ''}
        ${v.state === 'Completed' ? `<div class="note ok" style="margin-top:var(--s3)">Viewing completed.
          AED ${fmtAED(v.deposit.amount)} is held and will be credited at checkout, or refunded in full if you do not buy.</div>
          <a class="btn btn-primary btn-block" style="margin-top:var(--s3)" href="#/checkout">Continue to checkout</a>` : ''}
        ${v.state === 'No-show' ? `<div class="note err" style="margin-top:var(--s3)">No-show recorded. The deposit is
          non-refundable and the attribution record closes as Not Purchased.</div>` : ''}
      </div>

      <div class="card" style="margin-top:var(--s3)">
        <div class="eyebrow">Attribution ${std('§13')}</div>
        <div class="row tight">
          ${['Recommended', 'Requested', 'Confirmed', 'Viewed', 'Purchased'].map(st =>
            pill(st, (v.attribution.history.some(h => h.stage === st) || (st === 'Purchased' && S.order)) ? 'ok' : 'ghost')).join('')}
        </div>
      </div>` : ''}
    </div>
  </div>
</section>`;
});

function qrSvg(payload) {
  /* Deterministic visual stand-in for the Viewing ID / QR pass. */
  let h = 0; for (let i = 0; i < payload.length; i++) h = (h * 31 + payload.charCodeAt(i)) >>> 0;
  const N = 19, cells = [];
  const finder = (x, y) => (x < 5 && y < 5) || (x > N - 6 && y < 5) || (x < 5 && y > N - 6);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    h = (h * 1103515245 + 12345) >>> 0;
    const on = finder(x, y)
      ? !(((x % (N - 5)) === 1 || (x % (N - 5)) === 3) && (y === 1 || y === 3)) && ((x + y) % 4 !== 3)
      : (h >> 7) % 3 === 0;
    if (on) cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
  }
  return `<svg viewBox="-1 -1 ${N + 2} ${N + 2}" width="128" height="128" fill="#12345B"
    style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:6px;flex:0 0 128px"
    aria-label="Viewing QR pass">${cells.join('')}</svg>`;
}

/* ============================================================
   WF-05 — Purchase, checkout & payment
   ============================================================ */
route('checkout', () => {
  if (!S.customer) return registerView('checkout');
  const o = currentOption();
  if (!o) return redirect('#/recommendations');
  if (!S.reservation) S.reservation = C.createReservation(C.validateSellers(o.items));
  const res = S.reservation;
  const credit = C.depositCredit(S.viewing);
  const gross = o.items.reduce((t, i) => t + i.offer.sellingPrice * (i.qty || 1), 0);
  const sellers = new Set(o.items.map(i => i.offer.partnerId)).size;

  return `
<section class="section wrap">
  ${stepper(4)}
  <div class="eyebrow">AID-LOG-014 · one cart → one checkout → one payment</div>
  <h1 class="display d2">Checkout</h1>
  <p class="meta" style="max-width:680px">${o.items.length} products from ${sellers} showroom${sellers === 1 ? '' : 's'}
  — you pay AIDOOi once and we split the order behind the scenes.</p>

  <div class="split" style="margin-top:var(--s5)">
    <div class="card pad-lg">
      <h3>Final seller validation ${std('§3')}</h3>
      <p class="meta">No payment is captured until every line is confirmed.</p>
      <table class="data">
        <thead><tr><th>Product</th><th>Showroom</th><th>Status</th><th class="num">Line</th></tr></thead>
        <tbody>${res.lines.map(l => `
          <tr>
            <td><div class="row" style="gap:12px;flex-wrap:nowrap;align-items:center">
              <div class="tile" style="width:46px;flex:0 0 46px">${productArt(l.item.product)}</div>
              <div><div style="font-weight:600;color:var(--navy)">${esc(l.item.product.name)}${l.item.qty > 1 ? ` × ${l.item.qty}` : ''}</div>
              <span class="std">${esc(l.item.offer.id)}</span></div></div></td>
            <td>${esc(l.partner.name)}</td>
            <td>${pill(l.status, l.confirmed ? 'ok' : 'err')}</td>
            <td class="num">AED ${fmtAED(l.item.offer.sellingPrice * (l.item.qty || 1))}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="sticky">
      <div class="card pad-lg">
        <h3>One payment</h3>
        <table class="data">
          <tr><td>Order total</td><td class="num">AED ${fmtAED(gross)}</td></tr>
          <tr><td>Viewing deposit credit</td><td class="num">${credit ? '− AED ' + fmtAED(credit) : '—'}</td></tr>
          <tr><td><strong>Payable to AIDOOi</strong></td><td class="num"><strong>AED ${fmtAED(Math.max(0, gross - credit))}</strong></td></tr>
        </table>
        <div class="note" style="margin-top:var(--s3)">Reservation ${pill(res.state, res.state === 'Active' ? 'ok' : 'err')}
          · 24-hour purchase window opened ${new Date(res.startedAt).toLocaleTimeString()}, expiring
          ${new Date(res.expiresAt).toLocaleString()} ${std('§4')}.</div>
        <button class="btn btn-primary btn-block btn-lg" style="margin-top:var(--s4)" data-act="pay" ${res.state === 'Active' ? '' : 'disabled'}>
          Pay AED ${fmtAED(Math.max(0, gross - credit))}</button>
        <small style="display:block;margin-top:12px">No seller may begin fulfilment before a complete successful payment.</small>
      </div>
    </div>
  </div>
</section>`;
});

/* ============================================================
   WF-06 / 07 / 08 — Orders, issues, settlement
   ============================================================ */
route('orders', () => {
  if (!S.orders.length) return `
    <section class="section wrap">${stepper(5)}
      <h1 class="display d2">No orders yet</h1>
      <p class="lead" style="max-width:520px">Complete a checkout to see the master order, the seller splits and
      line-level fulfilment with settlement eligibility.</p>
      <a class="btn btn-primary" href="#/paths">Start a furnishing journey</a></section>`;

  const settlements = C.settlementRun(S.orders);
  return `
<section class="section wrap">
  ${stepper(5)}
  <h1 class="display d2">Your orders</h1>
  ${S.orders.map(order => `
    <div class="card pad-lg" style="margin-top:var(--s4)">
      <div class="row between" style="align-items:center">
        <div><div class="eyebrow">Master order</div><h3 style="margin:0">${esc(order.id)}</h3>
          <div class="meta">${new Date(order.placedAt).toLocaleString()} · ${order.sellerOrders.length} seller order(s)</div></div>
        <div style="text-align:right">${pill(C.masterStatus(order), 'navy')}<div style="margin-top:10px">${money(order.paid)}</div></div>
      </div>
      ${order.sellerOrders.map(so => `
        <div class="card soft" style="margin-top:var(--s3)">
          <div class="row between" style="align-items:center">
            <strong>${esc(so.partner.name)}</strong>
            <span class="meta">${esc(so.id)} · ${esc(so.partner.location)}</span>
          </div>
          <table class="data" style="margin-top:var(--s2)">
            <thead><tr><th>Line</th><th>State</th><th>Settlement</th><th class="num">Amount</th><th></th></tr></thead>
            <tbody>${so.lines.map(l => `
              <tr>
                <td>${esc(l.snapshot.productName)}<br><span class="std">${esc(l.id)} · ${esc(l.snapshot.offerId)} · ${(l.snapshot.commissionRate * 100).toFixed(0)}% commission</span></td>
                <td>${pill(l.state, l.state === 'Receipt Confirmed' ? 'ok' : '')}
                    ${l.issues.filter(i => i.state === 'Open').map(i => pill(i.flag, 'err')).join('')}</td>
                <td>${pill(l.settlement, l.settlement === 'Eligible' ? 'ok' : l.settlement === 'On Hold' ? 'warn' : '')}</td>
                <td class="num">AED ${fmtAED(l.snapshot.grossLineAmount)}</td>
                <td class="num">${nextStateButton(l)}
                  ${l.state !== 'Receipt Confirmed' && !l.issues.some(i => i.state === 'Open')
                    ? `<button class="btn btn-text" data-act="raise-issue" data-line="${esc(l.id)}">Report issue</button>` : ''}
                  ${l.issues.some(i => i.state === 'Open')
                    ? `<button class="btn btn-text" data-act="resolve-issue" data-line="${esc(l.id)}">Resolve</button>` : ''}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`).join('')}
    </div>`).join('')}

  <div class="card pad-lg" style="margin-top:var(--s5)">
    <div class="eyebrow">AID-LOG-014 · monthly seller settlement</div>
    <h3>Gross eligible sales − commission − adjustments = net payable</h3>
    <table class="data">
      <thead><tr><th>Partner</th><th class="num">Eligible lines</th><th class="num">Gross</th>
        <th class="num">Commission</th><th class="num">On hold</th><th class="num">Net payable</th></tr></thead>
      <tbody>${settlements.map(s => `
        <tr><td>${esc(s.partner.name)}</td><td class="num">${s.lines}</td>
          <td class="num">AED ${fmtAED(s.gross)}</td>
          <td class="num">− AED ${fmtAED(s.commission)}</td>
          <td class="num">${s.held ? 'AED ' + fmtAED(s.held) : '—'}</td>
          <td class="num"><strong>AED ${fmtAED(s.net)}</strong></td></tr>`).join('')}
      </tbody>
    </table>
    <small style="display:block;margin-top:12px">Only delivered + receipt-confirmed (or 72-hour auto-confirmed) lines
    become settlement eligible ${std('AID-LOG-015 §6–7')}.</small>
  </div>
</section>`;
});

function nextStateButton(line) {
  const next = C.LINE_FLOW[C.LINE_FLOW.indexOf(line.state) + 1];
  if (!next || line.state === 'Refunded') return '';
  return `<button class="btn btn-ghost btn-sm" data-act="advance" data-line="${esc(line.id)}" data-to="${esc(next)}">${esc(next)}</button>`;
}

/* ============================================================
   Registration gate (AID-LOG-013)
   ============================================================ */
function registerView(resume) {
  S.pendingAction = resume;
  return `
<section class="section wrap" style="max-width:560px">
  <div class="eyebrow">AID-LOG-013 · registration required</div>
  <h1 class="display d2">Create your AIDOOi account</h1>
  <p class="lead">Guests explore and get recommendations freely. Registration is required only at viewing and
  purchase — and you return to exactly where you were, with your project intact.</p>
  <div class="card pad-lg" style="margin-top:var(--s4)">
    <label class="field"><span>Full name</span><input type="text" id="reg-name" placeholder="Your name"></label>
    <label class="field"><span>Mobile or email</span><input type="text" id="reg-contact" placeholder="+971 50 000 0000"></label>
    <button class="btn btn-primary btn-block btn-lg" data-act="register">Continue</button>
  </div>
</section>`;
}

/* ============================================================
   Engine console
   ============================================================ */
route('standards', () => {
  const st = catalogueStats(), r = S.run;
  const gates = [
    ['Product data', 'Only Verified/Active canonical products and eligible AIO offers enter recommendation.',
      `${st.products} products, all Verified + Active; offers filtered on Active + in stock.`],
    ['Recommendation', `No hard requirement failure; product match ≥ ${MIN_PRODUCT_MATCH}; composition ≥ ${MIN_COMPOSITION}.`,
      r ? `Last run scored ${r.options.map(o => o.score).join(', ') || '—'}` : 'Run a recommendation to evaluate.'],
    ['Fit', 'Fit and function cannot be overridden by style, colour, discount or the Premium objective.',
      'Fit below 50, and any product wider than the usable wall run, is rejected before scoring.'],
    ['Four options', 'Options are valid and meaningfully differentiated; no artificial weak option.',
      r ? `${r.options.length} offered, ${r.suppressed.length} suppressed with a stated reason.` : '—'],
    ['Visualization', 'Recommended purchasable products stay traceable and recognizably represented.',
      'Every drawn shape carries its AID and AIO and opens the product card.'],
    ['Viewing', 'Every recommended product is physically viewable; confirmed viewing uses a valid location.',
      'Offers are eligible only when viewable; stops group by partner location.'],
    ['Deposit', '5% of selected viewing products, max AED 500; completed/no purchase = full refund; purchase = full credit; no-show = non-refundable.',
      S.viewing ? `Current viewing deposit AED ${fmtAED(S.viewing.deposit.amount)} (${S.viewing.deposit.state}).` : 'No viewing in session.'],
    ['Payment', 'No capture before all required seller validations; no fulfilment before complete successful payment.',
      S.order ? 'Captured after all lines confirmed.' : 'Checkout blocks payment unless the reservation is Active.'],
    ['Orders', 'Master order splits correctly into seller orders and order lines with locked transaction snapshots.',
      S.orders.length ? `${S.orders.length} master order(s) in session.` : '—'],
    ['Settlement', 'Only delivered + receipt-confirmed or eligible auto-confirmed lines become settlement eligible.',
      'Line settlement flips to Eligible only on Receipt Confirmed; an open issue moves it to On Hold.']
  ];

  return `
<section class="section wrap">
  <div class="eyebrow">Engine console</div>
  <h1 class="display d2">What the engine is actually doing</h1>
  <p class="lead" style="max-width:680px">This page is for the build team: the live catalogue, the scoring weights
  in force and the MVP acceptance gates from Master Plan §9.</p>

  <div class="grid g4" style="margin-top:var(--s5)">
    ${[['Parent products', st.parents, 'AIP'], ['Canonical variants', st.products, 'AID'],
       ['Seller offers', st.offers, 'AIO'], ['Partner showrooms', st.partners, 'PRT']].map(([l, v, c]) =>
      `<div class="card stat"><div class="v num">${v}</div><div class="l">${l}</div><div class="std" style="margin-top:4px">${c}</div></div>`).join('')}
  </div>

  <div class="grid g2" style="margin-top:var(--s4)">
    <div class="card pad-lg">
      <div class="eyebrow">AID-LOG-009 §3 · product match score</div>
      ${[['Fit quality', 30], ['Style match', 25], ['Colour match', 15], ['Budget / value', 15], ['Practical match', 10], ['Availability', 5]]
        .map(([l, w]) => `<div class="kv"><span>${l}</span><span class="bar beige"><i style="width:${w * 3.3}%"></i></span><span>${w}%</span></div>`).join('')}
      <small>Minimum recommendation score ${MIN_PRODUCT_MATCH}/100. Tie-break: fit → style → availability → value.</small>
    </div>
    <div class="card pad-lg">
      <div class="eyebrow">AID-LOG-010 §9 · composition score</div>
      ${[['Product match quality', 40], ['Composition harmony', 30], ['Functional completeness', 20], ['Budget performance', 10]]
        .map(([l, w]) => `<div class="kv"><span>${l}</span><span class="bar beige"><i style="width:${w * 2.3}%"></i></span><span>${w}%</span></div>`).join('')}
      <small>Minimum composition score ${MIN_COMPOSITION}/100, every essential function complete, no product below ${MIN_PRODUCT_MATCH}.</small>
    </div>
  </div>

  <div class="card pad-lg" style="margin-top:var(--s4)">
    <div class="eyebrow">Master Plan §9 · MVP acceptance gates</div>
    <table class="data">
      <thead><tr><th>Gate</th><th>Minimum acceptance condition</th><th>In this build</th></tr></thead>
      <tbody>${gates.map(([g, c, s]) => `<tr><td><strong>${g}</strong></td><td>${c}</td><td class="meta">${s}</td></tr>`).join('')}</tbody>
    </table>
  </div>

  <div class="card pad-lg" style="margin-top:var(--s3)">
    <div class="eyebrow">Partner register ${std('AID-LOG-013')}</div>
    <table class="data">
      <thead><tr><th>Partner</th><th>Location</th><th>Status</th><th class="num">Commission</th></tr></thead>
      <tbody>${PARTNERS.map(p => `<tr><td>${esc(p.name)}<br><span class="std">${esc(p.id)}</span></td>
        <td>${esc(p.location)}</td><td>${pill(p.status, 'ok')}</td><td class="num">${(p.commission * 100).toFixed(0)}%</td></tr>`).join('')}</tbody>
    </table>
    <small style="display:block;margin-top:12px">There is no seller portal in MVP — AIDOOi Admin creates and verifies
    all product data ${std('WF-08')}.</small>
  </div>
</section>`;
});

/* ============================================================
   Modals
   ============================================================ */
function openModal(html) {
  const el = document.createElement('div');
  el.className = 'overlay';
  el.innerHTML = `<div class="modal">${html}</div>`;
  el.addEventListener('click', e => { if (e.target === el) el.remove(); });
  document.body.appendChild(el);
  return el;
}
const closeModal = () => document.querySelectorAll('.overlay').forEach(e => e.remove());
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function productCardModal(it) {
  const p = it.product, o = it.offer, partner = partnerById[o.partnerId];
  openModal(`
    <div class="row between" style="align-items:flex-start">
      <div><div class="eyebrow">${esc(p.mainCategory)} › ${esc(p.category)} › ${esc(p.type)}</div>
        <h2 class="display d3" style="margin:0">${esc(p.name)}</h2></div>
      <button class="btn btn-text" data-act="close-modal">Close</button>
    </div>
    <div class="split" style="gap:var(--s4);margin-top:var(--s4)">
      <div class="tile wide">${productArt(p)}</div>
      <div>
        <div class="row between" style="align-items:center">${money(o.sellingPrice)}
          ${pill(`${it.total} · ${classifyMatch(it.total)}`, it.total >= 80 ? 'ok' : '')}</div>
        ${o.originalPrice ? `<div class="meta">Was AED ${fmtAED(o.originalPrice)}</div>` : ''}
        <table class="data" style="margin-top:var(--s3)">
          <tr><td>Dimensions</td><td>${esc(p.width)} W × ${esc(p.depth)} D × ${esc(p.height)} H cm</td></tr>
          <tr><td>Style</td><td>${esc(p.primaryStyle)}${p.secondaryStyle ? ' / ' + esc(p.secondaryStyle) : ''}</td></tr>
          <tr><td>Colour</td><td>${esc(p.primaryColour)}</td></tr>
          <tr><td>Material</td><td>${esc(p.material)}</td></tr>
          <tr><td>Availability</td><td>${esc(o.availability)} · ${esc(o.viewingStatus)} · delivery ${o.deliveryDays} days</td></tr>
          <tr><td>Showroom</td><td>${esc(partner.name)} — ${esc(partner.location)}</td></tr>
          <tr><td>Price tier</td><td>${esc(tierOfPrice(p.type, p.branch, o.sellingPrice))}</td></tr>
          <tr><td>Identifiers</td><td class="std">${esc(p.parentId)} · ${esc(p.id)}<br>${esc(o.id)} · SKU ${esc(o.sellerSku)}</td></tr>
        </table>
      </div>
    </div>
    <h3 style="margin-top:var(--s5)">Why this product scored ${it.total} ${std('AID-LOG-009 §3')}</h3>
    ${matchBars(it)}
    <div class="row" style="margin-top:var(--s4)">
      <button class="btn btn-secondary" data-act="replace" data-item="${esc(it.slot.key)}">Replace this product</button>
      <button class="btn btn-ghost" data-act="close-modal">Keep it</button>
    </div>`);
}

function replaceModal(it) {
  const alts = alternativesFor(S.run, currentOption(), it);
  openModal(`
    <div class="row between" style="align-items:flex-start">
      <div><div class="eyebrow">Replace · ${esc(it.product.type)}</div>
        <h2 class="display d3" style="margin:0">Eligible alternatives</h2></div>
      <button class="btn btn-text" data-act="close-modal">Close</button>
    </div>
    <p class="meta">Only eligible alternatives are shown. Your choice is revalidated against fit, practical needs,
    availability, budget and composition harmony before it is applied ${std('WF-03 steps 6–8')}.</p>
    <div id="replace-msg"></div>
    <div class="pgrid" style="margin-top:var(--s3)">
      ${alts.map((c, i) => `
        <div class="pcard">${tile(c.product)}
          <div class="body">
            <div class="nm">${esc(c.product.name)}</div>
            <div class="sub">${esc(c.product.primaryStyle)} · ${esc(c.product.primaryColour)} · ${esc(c.product.width)} cm</div>
            <div class="foot">${money(c.offer.sellingPrice, 'sm')}${pill('Match ' + c.total, c.total >= 80 ? 'ok' : '')}</div>
            <button class="btn btn-secondary btn-sm btn-block" style="margin-top:10px"
              data-act="apply-replace" data-item="${esc(it.slot.key)}" data-alt="${i}">Use this instead</button>
          </div></div>`).join('')}
    </div>`);
  window.__alts = alts;
}

/* ============================================================
   Actions
   ============================================================ */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act], [data-spec-set]');
  if (!t) return;

  if (t.dataset.specSet) {
    const k = t.dataset.specSet, v = t.dataset.val;
    if (k === 'style' || k === 'colour' || k === 'tier') S.project[k] = v;
    else S.project.spec[k] = v;
    save(); render();
    return;
  }

  const act = t.dataset.act;
  const o = currentOption();

  switch (act) {
    case 'pick-path': {
      const id = t.dataset.id;
      const spec = {};
      if (id === 'individualProduct') {
        spec.productType = INDIVIDUAL_TYPES[0];
        spec.branch = BRANCH_OPTS[spec.productType][1];
      }
      S.project = { pathId: id, spec, style: 'assisted', colour: 'assisted', tier: null, projectBudget: '' };
      S.run = S.projectRun = S.individual = S.viewing = S.reservation = null;
      save(); go('#/profile');
      break;
    }
    case 'run': {
      const p = pathById(S.project.pathId);
      S.reservation = null;
      if (p.kind === 'room') {
        S.run = runRecommendation(S.project);
        S.optionKey = S.run.options[0] && S.run.options[0].key;
      } else if (p.kind === 'project') {
        const r = projectBudget(p.id, TIERS.indexOf(S.project.tier), S.project.spec);
        S.project.projectBudget = r[1];
        S.projectRun = runProject(S.project);
      } else {
        S.individual = rankIndividual({
          type: S.project.spec.productType, branch: S.project.spec.branch || null,
          style: S.project.style, colour: S.project.colour, tier: S.project.tier
        });
      }
      save(); go('#/recommendations');
      break;
    }
    case 'open-option': S.optionKey = t.dataset.key; save(); go('#/option/' + t.dataset.key); break;
    case 'viz': S.vizMode = t.dataset.mode; render(); break;
    case 'open-module': {
      const m = S.projectRun.modules[Number(t.dataset.mod)];
      S.run = m.run; S.optionKey = m.run.options[0].key;
      S.project = { ...S.project, spec: { ...S.project.spec, length: Math.sqrt(m.area * 1.35), width: Math.sqrt(m.area / 1.35) } };
      save(); go('#/option/' + S.optionKey);
      break;
    }
    case 'why': {
      const opt = S.run.options.find(x => x.key === t.dataset.key);
      openModal(`
        <div class="row between" style="align-items:flex-start">
          <div><div class="eyebrow">${esc(opt.classification)}</div>
            <h2 class="display d3" style="margin:0">${esc(opt.label)}</h2></div>
          <button class="btn btn-text" data-act="close-modal">Close</button></div>
        <p>${esc(opt.blurb)}</p>
        ${scoreBars(opt)}
        <p class="meta" style="margin-top:var(--s3)">All four options share one quality foundation. They differ only
        in the optimization objective applied after the minimum quality is satisfied ${std('AID-LOG-010 §14, §18')}.</p>`);
      break;
    }
    case 'card':    productCardModal(o.items.find(i => i.slot.key === t.dataset.item)); break;
    case 'replace': closeModal(); replaceModal(o.items.find(i => i.slot.key === t.dataset.item)); break;
    case 'apply-replace': {
      const res = applyReplacement(S.run, o, t.dataset.item, window.__alts[Number(t.dataset.alt)]);
      if (!res.ok) {
        const box = document.getElementById('replace-msg');
        if (box) box.innerHTML = `<div class="note err" style="margin-top:var(--s3)">Replacement rejected — ${esc(res.reason)}</div>`;
      } else { closeModal(); S.reservation = null; save(); render(); }
      break;
    }
    case 'remove': {
      const res = removeItem(S.run, o, t.dataset.item);
      if (!res.ok) alert(res.reason);
      S.reservation = null; save(); render();
      break;
    }
    case 'start-viewing': {
      if (!S.customer) { S.pendingAction = 'viewing'; go('#/viewing'); break; }
      S.viewing = C.createViewing({ items: o.items, projectId: S.run.runId, customer: S.customer });
      save(); go('#/viewing');
      break;
    }
    case 'start-purchase': S.reservation = null; go('#/checkout'); break;
    case 'register': {
      const name = document.getElementById('reg-name').value.trim() || 'Guest Customer';
      const contact = document.getElementById('reg-contact').value.trim();
      S.customer = { name, contact, id: 'CUS-' + Math.random().toString(36).slice(2, 8).toUpperCase() };
      const resume = S.pendingAction;
      if (resume === 'viewing' && !S.viewing && o)
        S.viewing = C.createViewing({ items: o.items, projectId: S.run.runId, customer: S.customer });
      save(); go('#/' + (resume || 'recommendations'));
      break;
    }
    case 'confirm-sellers': C.confirmSellers(S.viewing); save(); render(); break;
    case 'pay-deposit':     C.payDeposit(S.viewing);     save(); render(); break;
    case 'viewing-outcome': C.recordViewingOutcome(S.viewing, t.dataset.val); save(); render(); break;
    case 'pay': {
      const res = C.capturePayment({ items: o.items, reservation: S.reservation, viewing: S.viewing, customer: S.customer });
      if (!res.ok) { alert(res.reason); break; }
      S.order = res.order; S.orders.push(res.order);
      if (S.viewing) {
        S.viewing.attribution.stage = 'Purchased';
        S.viewing.attribution.history.push({ stage: 'Purchased', at: Date.now() });
      }
      S.reservation = null; save(); go('#/orders');
      break;
    }
    case 'advance': {
      const res = C.advanceLine(findLine(t.dataset.line), t.dataset.to);
      if (!res.ok) alert(res.reason);
      save(); render();
      break;
    }
    case 'raise-issue': {
      const line = findLine(t.dataset.line);
      openModal(`
        <h2 class="display d3" style="margin-top:0">Report an issue</h2>
        <p class="meta">AIDOOi governs and tracks the issue; the responsible partner executes the resolution ${std('WF-07')}.</p>
        <div class="grid g2">${C.ISSUE_FLAGS.map(f =>
          `<button class="btn btn-secondary" data-act="do-raise" data-line="${esc(line.id)}" data-flag="${esc(f)}">${esc(f)}</button>`).join('')}</div>
        <button class="btn btn-text" style="margin-top:var(--s3)" data-act="close-modal">Cancel</button>`);
      break;
    }
    case 'do-raise': {
      C.raiseIssue(findLine(t.dataset.line), t.dataset.flag, '');
      closeModal(); save(); render();
      break;
    }
    case 'resolve-issue': {
      const line = findLine(t.dataset.line);
      const issue = line.issues.find(i => i.state === 'Open');
      openModal(`
        <h2 class="display d3" style="margin-top:0">Resolve “${esc(issue.flag)}”</h2>
        <div class="row">${['Resolved', 'Refunded', 'Rejected'].map(r =>
          `<button class="btn btn-secondary" data-act="do-resolve" data-line="${esc(line.id)}" data-res="${r}">${r}</button>`).join('')}</div>
        <p class="meta" style="margin-top:var(--s3)">A refund before settlement prevents eligibility; a refund after
        settlement creates a future settlement adjustment ${std('WF-07 steps 7–8')}.</p>
        <button class="btn btn-text" data-act="close-modal">Cancel</button>`);
      break;
    }
    case 'do-resolve': {
      const line = findLine(t.dataset.line);
      C.resolveIssue(line, line.issues.find(i => i.state === 'Open'), t.dataset.res);
      closeModal(); save(); render();
      break;
    }
    case 'close-modal': closeModal(); break;
    case 'reset': localStorage.removeItem('aidooi'); location.hash = '#/'; location.reload(); break;
  }
});

/* Visualization hotspot → product card (AID-LOG-011 §4) */
document.addEventListener('click', e => {
  const hs = e.target.closest('.hotspot');
  if (!hs) return;
  const o = currentOption();
  const it = o && o.items.find(i => i.slot.key === hs.dataset.item);
  if (it) productCardModal(it);
});

function onFieldInput(e) {
  const k = e.target.dataset.spec;
  if (!k || !S.project) return;
  if (k === 'projectBudget') S.project.projectBudget = e.target.value;
  else S.project.spec[k] = e.target.value;
  if (k === 'productType') {
    const bo = BRANCH_OPTS[e.target.value];
    S.project.spec.branch = bo ? bo[Math.min(1, bo.length - 1)] : null;
  }
  save();
  if (['length', 'width', 'totalArea', 'livingArea', 'productType'].includes(k)) {
    clearTimeout(window.__t);
    window.__t = setTimeout(render, 450);
  } else {
    const btn = document.querySelector('[data-act="run"]');
    if (btn) btn.disabled = !profileReady();
  }
}
document.addEventListener('input', onFieldInput);
document.addEventListener('change', e => { if (e.target.tagName === 'SELECT') onFieldInput(e); });

function findLine(id) {
  for (const o of S.orders) for (const so of o.sellerOrders) {
    const l = so.lines.find(x => x.id === id);
    if (l) return l;
  }
  return null;
}

function redirect(hash) { setTimeout(() => go(hash), 0); return '<section class="section wrap"><p class="meta">Loading…</p></section>'; }

/* Only lightweight, re-derivable state is persisted. Recommendation runs hold
   live object graphs, so they are rebuilt rather than serialized. */
function save() {
  try { localStorage.setItem('aidooi', JSON.stringify({ customer: S.customer, project: S.project })); }
  catch { /* private window or blocked storage — the app works without it */ }
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem('aidooi') || 'null');
    if (!d) return;
    S.customer = d.customer || null;
    S.project = d.project || null;
  } catch { /* ignore */ }
}

/* ---------------- Boot ---------------- */
load();
document.getElementById('brand-mark').innerHTML = brandMark(34);
render();
