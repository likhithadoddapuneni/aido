/* ============================================================
   ui.js — Brand mark, interface icons and the measured room plan.
   Product imagery lives in art.js.
   Implements AID-DATA-015 §1 (brand), §6 (iconography) and
   AID-LOG-011 (visualization: declared fidelity + full traceability
   from every drawn item back to its AID and current AIO).
   ============================================================ */

import { planGlyph, bodyTone } from './art.js';

export { productArt } from './art.js';

export const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* ---------- Brand mark (AID-DATA-015 §1) ----------
   Rounded architectural arch above a four-square window motif.
   No eyebrow/roof mark above the squares. */
export const brandMark = (size = 32) => `
<svg class="mark" viewBox="0 0 48 52" width="${size}" height="${size * 52 / 48}" aria-hidden="true">
  <path d="M8 27a16 16 0 0 1 32 0v4a2 2 0 0 1-2 2h-2.4a2 2 0 0 1-2-2v-4a11.6 11.6 0 0 0-23.2 0v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" fill="#12345B"/>
  <rect x="16.6" y="35" width="6.6" height="6.6" rx="1.5" fill="#12345B"/>
  <rect x="24.8" y="35" width="6.6" height="6.6" rx="1.5" fill="#12345B"/>
  <rect x="16.6" y="43.4" width="6.6" height="4.6" rx="1.4" fill="#B7A78F"/>
  <rect x="24.8" y="43.4" width="6.6" height="4.6" rx="1.4" fill="#B7A78F"/>
</svg>`;

/* ---------- Minimal outline icon family (AID-DATA-015 §6) ---------- */
const P = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  sofa:   P('<path d="M3 12v6h18v-6"/><path d="M5 12V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4"/><path d="M3 14h18"/><path d="M6 18v2M18 18v2"/>'),
  bed:    P('<path d="M3 18v-7h18v7"/><path d="M3 11V6"/><path d="M21 11V8a2 2 0 0 0-2-2h-6v5"/><path d="M3 18v2M21 18v2"/>'),
  dining: P('<path d="M3 10h18"/><path d="M5 10v10M19 10v10"/><path d="M8 4v4M16 4v4M12 3v5"/>'),
  desk:   P('<path d="M3 8h18"/><path d="M4 8v12M20 8v12"/><path d="M8 12h6v4H8z"/>'),
  studio: P('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18M12 12v8"/>'),
  apartment: P('<path d="M4 20V7l7-3 9 4v12"/><path d="M8 20v-5h4v5"/><path d="M15 11h2M15 15h2"/>'),
  villa:  P('<path d="M2 11l10-7 10 7"/><path d="M5 11v9h14v-9"/><path d="M10 20v-6h4v6"/>'),
  lamp:   P('<path d="M8 3h8l3 7H5z"/><path d="M12 10v9"/><path d="M8 21h8"/>'),
  ruler:  P('<rect x="2" y="7" width="20" height="10" rx="2"/><path d="M7 7v4M12 7v6M17 7v4"/>'),
  sparkle:P('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
  eye:    P('<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/>'),
  bag:    P('<path d="M4 8h16l-1.2 12H5.2z"/><path d="M8.5 8V6a3.5 3.5 0 0 1 7 0v2"/>'),
  truck:  P('<path d="M2 7h11v10H2z"/><path d="M13 10h4l4 4v3h-8z"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>'),
  check:  P('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.6 2.6L16 9.6"/>'),
  qr:     P('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM19 19h2v2h-2zM14 19h2v2h-2zM19 14h2v2h-2z"/>')
};
export const icon = key => ICONS[key] || ICONS.sparkle;

/* ============================================================
   Measured room plan — AID-LOG-011
   Drawn from each product's verified width and depth against the
   customer's real room dimensions, so fit is shown rather than
   asserted. Fidelity is declared as Concept.
   ============================================================ */

const ZONE = {
  'Sofa': 'bottom', 'Bed': 'top', 'Dining Table': 'centre', 'Desk': 'top',
  'Coffee Table': 'centre-low', 'TV Unit': 'top', 'Console Table': 'top',
  'Accent Chair': 'left', 'Office Chair': 'anchor-front', 'Bench': 'bottom',
  'Side Table': 'bottom-flank', 'Bedside Table': 'top-flank',
  'Wardrobe': 'left', 'Chest of Drawers': 'right', 'Sideboard': 'right',
  'Bookcase': 'left', 'Storage Cabinet': 'right', 'Dining Chair': 'around',
  'Rug': 'floor', 'Floor Lamp': 'corner', 'Planter': 'corner',
  'Table Lamp': 'surface', 'Task Lamp': 'surface', 'Vase': 'surface',
  'Decorative Object': 'surface', 'Cushion': 'surface', 'Throw': 'surface',
  'Pendant Light': 'ceiling', 'Chandelier': 'ceiling',
  'Wall Art': 'wall', 'Mirror': 'wall', 'Wall Light': 'wall'
};

/**
 * @param option  a recommendation option from engine.runRecommendation
 * @param room    { area, lengthM, widthM }
 */
export function roomPlan(option, room) {
  const Lm = Math.max(1.6, room.lengthM || Math.sqrt((room.area || 20) * 1.35));
  const Wm = Math.max(1.6, room.widthM || (room.area || 20) / Lm);
  const SCALE = 820 / Math.max(Lm, 2.4);
  const W = Math.round(Lm * SCALE), H = Math.round(Wm * SCALE);
  const cm = v => (v / 100) * SCALE;
  const PAD = 16;

  const shapes = [];
  const cur = { leftY: PAD + 10, rightY: PAD + 10, corner: 0, wall: 0, surface: 0,
                'top-flank': 0, 'bottom-flank': 0, ceiling: 0, around: 0 };
  const anchor = { cx: W / 2, cy: H * 0.72, w: 0, h: 0 };

  /* Where the rug belongs depends on where the room's anchor sits: in front of
     a bed or desk at the top wall, under a dining table, or under the seating
     group when a sofa holds the bottom wall. */
  const anchorZone = option.items.map(i => ZONE[i.product.type])
    .find(z => z === 'top' || z === 'centre' || z === 'bottom') || 'bottom';
  const rugCentre = anchorZone === 'top' ? 0.66 : anchorZone === 'centre' ? 0.5 : 0.46;

  const sorted = option.items.slice().sort((a, b) => {
    const rank = t => ZONE[t] === 'floor' ? 0 : ['bottom', 'top', 'centre'].includes(ZONE[t]) ? 1 : 2;
    return rank(a.product.type) - rank(b.product.type);
  });

  for (const it of sorted) {
    const p = it.product;
    const zone = ZONE[p.type] || 'wall';
    const qty = it.qty || 1;
    const w = Math.max(cm(p.width), 9);
    const h = Math.max(cm(p.depth || p.width * 0.6), 9);

    for (let k = 0; k < qty; k++) {
      let x, y, bw = w, bh = h;
      switch (zone) {
        case 'floor': {
          /* A rug lies along the room's long axis, whichever way it is listed. */
          const landscape = W >= H;
          bw = landscape ? Math.max(w, h) : Math.min(w, h);
          bh = landscape ? Math.min(w, h) : Math.max(w, h);
          x = W / 2 - bw / 2;
          y = Math.min(H - bh - PAD, Math.max(PAD, H * rugCentre - bh / 2)); break;
        }
        case 'bottom':       x = W / 2 - w / 2; y = H - h - PAD;
                             Object.assign(anchor, { cx: W / 2, cy: y, w, h }); break;
        case 'top':          x = W / 2 - w / 2; y = PAD;
                             if (p.type === 'Bed' || p.type === 'Desk') Object.assign(anchor, { cx: W / 2, cy: y, w, h });
                             break;
        case 'centre':       x = W / 2 - w / 2; y = H / 2 - h / 2;
                             Object.assign(anchor, { cx: W / 2, cy: y, w, h }); break;
        case 'centre-low':   x = W / 2 - w / 2; y = H * 0.54 - h / 2; break;
        case 'anchor-front': x = W / 2 - w / 2; y = (anchor.cy || PAD) + (anchor.h || cm(70)) + 10; break;
        case 'around': {
          const n = qty, a = (Math.PI * 2 * k) / n - Math.PI / 2;
          const rx = (anchor.w || cm(160)) / 2 + w * 0.8;
          const ry = (anchor.h || cm(90)) / 2 + h * 0.8;
          x = W / 2 + Math.cos(a) * rx - w / 2;
          y = (anchor.cy + (anchor.h || 0) / 2) + Math.sin(a) * ry - h / 2;
          break;
        }
        case 'top-flank': {
          const side = (cur['top-flank']++ % 2) ? 1 : -1;
          x = W / 2 + side * ((anchor.w || cm(180)) / 2 + w * 0.6) - w / 2; y = PAD + 2; break;
        }
        case 'bottom-flank': {
          const side = (cur['bottom-flank']++ % 2) ? 1 : -1;
          x = W / 2 + side * ((anchor.w || cm(200)) / 2 + w * 0.6) - w / 2; y = H - h - PAD - 2; break;
        }
        /* Against a side wall the piece turns 90°: its width runs along the wall. */
        case 'left':  { bw = h; bh = w; x = PAD; y = Math.min(cur.leftY, H - bh - PAD); cur.leftY = y + bh + 14; break; }
        case 'right': { bw = h; bh = w; x = W - bw - PAD; y = Math.min(cur.rightY, H - bh - PAD); cur.rightY = y + bh + 14; break; }
        case 'corner': {
          const s = [[PAD + w / 2, PAD + w / 2], [W - PAD - w / 2, PAD + w / 2],
                     [PAD + w / 2, H - PAD - w / 2], [W - PAD - w / 2, H - PAD - w / 2]][cur.corner++ % 4];
          x = s[0] - w / 2; y = s[1] - w / 2; bh = w; break;
        }
        case 'ceiling': {
          const n = cur.ceiling++;
          x = W / 2 - w / 2 + (n - (qty - 1) / 2) * w * 1.8; y = H / 2 - w / 2; bh = w; break;
        }
        case 'surface': {
          const s = [[W * 0.5, H * 0.46], [W * 0.26, H * 0.86], [W * 0.74, H * 0.86], [W * 0.2, H * 0.22]][cur.surface++ % 4];
          bw = bh = Math.max(w, 14); x = s[0] - bw / 2; y = s[1] - bh / 2; break;
        }
        default: {
          const n = cur.wall++;
          x = Math.min(W * (0.2 + (n * 0.27) % 0.62), W - w - PAD); y = 5; bh = 7;
        }
      }
      shapes.push({ it, x, y, w: bw, h: bh, zone });
    }
  }

  const body = shapes.map(s => {
    const p = s.it.product;
    const soft = ['floor', 'wall', 'ceiling'].includes(s.zone);
    return `<g class="hotspot" data-item="${esc(s.it.slot.key)}" tabindex="0" role="button"
       aria-label="${esc(p.name)}"><title>${esc(p.name)} · ${esc(p.id)} · ${p.width}×${p.depth} cm</title>
      ${soft ? '' : `<rect x="${(s.x + 2).toFixed(1)}" y="${(s.y + 3).toFixed(1)}" width="${s.w.toFixed(1)}" height="${s.h.toFixed(1)}" rx="4" fill="#12345B" opacity=".09"/>`}
      ${planGlyph(p.type, s.x, s.y, s.w, s.h, p)}</g>`;
  }).join('');

  return {
    svg: `
<svg viewBox="-40 -26 ${W + 82} ${H + 78}" preserveAspectRatio="xMidYMid meet" role="img"
     aria-label="Measured plan of the recommended composition">
  <defs>
    <pattern id="plank" width="${(SCALE * 0.18).toFixed(1)}" height="${(SCALE * 1.1).toFixed(1)}" patternUnits="userSpaceOnUse">
      <rect width="100%" height="100%" fill="#FBF8F3"/>
      <path d="M0 0v${SCALE * 1.1}" stroke="#EFE9E0" stroke-width="1"/>
      <path d="M0 ${(SCALE * 0.55).toFixed(1)}h${(SCALE * 0.18).toFixed(1)}" stroke="#F2EDE5" stroke-width="1"/>
    </pattern>
  </defs>
  <rect x="-10" y="-10" width="${W + 20}" height="${H + 20}" rx="4" fill="#ECE6DC"/>
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#plank)"/>
  <path d="M0 0h${W}v${H}h${-W}z" fill="none" stroke="#12345B" stroke-width="2" opacity=".5"/>
  <path d="M${W * 0.08} 0a${W * 0.14} ${W * 0.14} 0 0 0 ${W * 0.14} ${W * 0.14}" fill="none" stroke="#C9C1B4" stroke-width="1.4" stroke-dasharray="5 4"/>
  <path d="M${W * 0.08} -10v20" stroke="#ECE6DC" stroke-width="5"/>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" fill="#6B7280">
    <path d="M0 ${H + 20}h${W}M0 ${H + 15}v10M${W} ${H + 15}v10" stroke="#C9C1B4" stroke-width="1"/>
    <text x="${W / 2}" y="${H + 38}" text-anchor="middle">${Lm.toFixed(2)} m</text>
    <path d="M-20 0v${H}M-25 0h10M-25 ${H}h10" stroke="#C9C1B4" stroke-width="1"/>
    <text x="-24" y="${H / 2}" text-anchor="middle" transform="rotate(-90 -24 ${H / 2})">${Wm.toFixed(2)} m</text>
  </g>
  ${body}
</svg>`,
    fidelity: 'Concept',
    note: 'Measured plan drawn to scale from each product’s verified dimensions against your room. Every shape stays traceable to its AID and AIO — tap any item to open its Product Card.'
  };
}
