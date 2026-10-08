/* ============================================================
   art.js — Product illustration system
   AID-DATA-012 (Product Images & Media) cannot be satisfied with
   photography in this build, so every product is DRAWN from its own
   verified structured data: product type, primary colour, material
   family and real proportions. The result is recognizable product
   imagery that stays honest — nothing is shown that the record does
   not contain.
   Imagery direction follows AID-DATA-015 §7: warm, calm, uncluttered.
   ============================================================ */

/* ---------- Colour ---------- */
const TONE = {
  white: '#EFEBE3', beige: '#D8C5A6', grey: '#9BA1A7', black: '#36393D',
  brown: '#8A5B38', natural: '#C6A676', green: '#6E8168', blue: '#3C5B7B',
  red: '#8B3B3B', orange: '#B4673C', yellow: '#C7A32C', pink: '#D3A5A0',
  purple: '#79648E', gold: '#BE9F60', silver: '#B4B8BC', brass: '#AE8C3F',
  bronze: '#886944', multicolour: '#B6A694'
};

const hex2rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgb2hex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => rgb2hex(hex2rgb(a).map((v, i) => v + (hex2rgb(b)[i] - v) * t));
export const lighten = (c, t) => mix(c, '#FFFFFF', t);
export const darken  = (c, t) => mix(c, '#101417', t);
export const bodyTone = p => TONE[p.primaryColour] || '#BFB5A6';

/* Legs, frames and hardware read from the material family (AID-DATA-008). */
const FRAME = {
  Wood: '#96663C', Rattan: '#BC9A62', Fabric: '#8C6239', Leather: '#6F4B2E',
  Metal: '#6F767D', Glass: '#8FA4B0', Stone: '#9E978C', Ceramic: '#A79F93'
};
export const frameTone = p => FRAME[p.material] || '#8C6239';

let uid = 0;

/** Wrap a drawing in a sized SVG with a soft contact shadow. */
function scene(inner, { w = 200, h = 150, shadow = [100, 132, 72, 7], label = '' } = {}) {
  const id = 'g' + (++uid);
  const [cx, cy, rx, ry] = shadow;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${label}">
  <defs><radialGradient id="sh${id}"><stop offset="0" stop-color="#12345B" stop-opacity=".22"/><stop offset="1" stop-color="#12345B" stop-opacity="0"/></radialGradient></defs>
  ${rx ? `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#sh${id})"/>` : ''}
  ${inner}</svg>`;
}

/* ============================================================
   Per-type renderers.  c = body colour, f = frame/leg colour.
   ============================================================ */
const R = {};

R.sofa = (c, f, o) => {
  const seats = Math.max(2, Math.min(5, o.seats || 3));
  const bw = 180, x0 = (200 - bw) / 2, arm = 15;
  const cw = (bw - arm * 2) / seats;
  let back = '', seat = '';
  for (let i = 0; i < seats; i++) {
    const x = x0 + arm + i * cw;
    back += `<rect x="${x + 2}" y="44" width="${cw - 4}" height="33" rx="6" fill="${c}" stroke="${darken(c, .16)}" stroke-width="1"/>`;
    seat += `<rect x="${x + 2}" y="78" width="${cw - 4}" height="25" rx="5" fill="${lighten(c, .1)}" stroke="${darken(c, .14)}" stroke-width="1"/>`;
  }
  return `<rect x="${x0}" y="40" width="${bw}" height="40" rx="9" fill="${darken(c, .08)}"/>
  ${back}<rect x="${x0}" y="74" width="${bw}" height="32" rx="7" fill="${darken(c, .05)}"/>${seat}
  <rect x="${x0}" y="54" width="${arm}" height="52" rx="7" fill="${lighten(c, .05)}" stroke="${darken(c, .16)}" stroke-width="1"/>
  <rect x="${x0 + bw - arm}" y="54" width="${arm}" height="52" rx="7" fill="${lighten(c, .05)}" stroke="${darken(c, .16)}" stroke-width="1"/>
  <rect x="${x0 + 11}" y="106" width="7" height="15" rx="2" fill="${f}"/>
  <rect x="${x0 + bw - 18}" y="106" width="7" height="15" rx="2" fill="${f}"/>`;
};

R.armchair = (c, f) => `
  <rect x="62" y="40" width="76" height="42" rx="10" fill="${darken(c, .08)}"/>
  <rect x="68" y="44" width="64" height="34" rx="7" fill="${c}" stroke="${darken(c, .16)}" stroke-width="1"/>
  <rect x="62" y="76" width="76" height="28" rx="7" fill="${darken(c, .05)}"/>
  <rect x="70" y="80" width="60" height="21" rx="5" fill="${lighten(c, .1)}" stroke="${darken(c, .14)}" stroke-width="1"/>
  <rect x="56" y="56" width="14" height="48" rx="6" fill="${lighten(c, .05)}" stroke="${darken(c, .16)}" stroke-width="1"/>
  <rect x="130" y="56" width="14" height="48" rx="6" fill="${lighten(c, .05)}" stroke="${darken(c, .16)}" stroke-width="1"/>
  <path d="M62 104l-6 17M138 104l6 17" stroke="${f}" stroke-width="5" stroke-linecap="round"/>`;

R.diningChair = (c, f) => `
  <rect x="80" y="30" width="40" height="46" rx="7" fill="${c}" stroke="${darken(c, .18)}" stroke-width="1"/>
  <path d="M88 40h24M88 52h24" stroke="${darken(c, .18)}" stroke-width="1.5" stroke-linecap="round"/>
  <rect x="72" y="76" width="56" height="12" rx="4" fill="${lighten(c, .08)}" stroke="${darken(c, .18)}" stroke-width="1"/>
  <path d="M76 88l-4 32M124 88l4 32M84 88l2 32M116 88l-2 32" stroke="${f}" stroke-width="4" stroke-linecap="round"/>`;

R.officeChair = (c, f) => `
  <rect x="78" y="26" width="44" height="46" rx="10" fill="${c}" stroke="${darken(c, .18)}" stroke-width="1"/>
  <rect x="84" y="34" width="32" height="30" rx="6" fill="${lighten(c, .09)}"/>
  <rect x="70" y="72" width="60" height="13" rx="5" fill="${lighten(c, .05)}" stroke="${darken(c, .18)}" stroke-width="1"/>
  <rect x="96" y="85" width="8" height="18" rx="3" fill="${f}"/>
  <path d="M100 103l-28 14M100 103l28 14M100 103v16" stroke="${f}" stroke-width="4" stroke-linecap="round"/>
  <circle cx="71" cy="120" r="5" fill="${darken(f, .2)}"/><circle cx="129" cy="120" r="5" fill="${darken(f, .2)}"/><circle cx="100" cy="123" r="5" fill="${darken(f, .2)}"/>`;

R.bench = (c, f) => `
  <rect x="34" y="70" width="132" height="16" rx="5" fill="${c}" stroke="${darken(c, .16)}" stroke-width="1"/>
  <path d="M34 76h132M34 81h132" stroke="${darken(c, .14)}" stroke-width="1.2" opacity=".6"/>
  <path d="M46 86v34M154 86v34M46 104h108" stroke="${f}" stroke-width="7" stroke-linecap="round"/>`;

R.table = (c, f, o) => {
  const w = o.w, th = o.th || 11, legH = o.legH, top = 120 - legH - th;
  const x0 = (200 - w) / 2;
  return `<rect x="${x0}" y="${top}" width="${w}" height="${th}" rx="4" fill="${c}" stroke="${darken(c, .18)}" stroke-width="1"/>
  <rect x="${x0 + 3}" y="${top + th - 3}" width="${w - 6}" height="3" fill="${darken(c, .14)}" opacity=".45"/>
  <rect x="${x0 + 8}" y="${top + th}" width="${o.legW || 7}" height="${legH}" rx="2" fill="${f}"/>
  <rect x="${x0 + w - 8 - (o.legW || 7)}" y="${top + th}" width="${o.legW || 7}" height="${legH}" rx="2" fill="${f}"/>
  ${o.shelf ? `<rect x="${x0 + 14}" y="${top + th + legH - 12}" width="${w - 28}" height="6" rx="2" fill="${darken(c, .1)}"/>` : ''}
  ${o.apron ? `<rect x="${x0 + 10}" y="${top + th}" width="${w - 20}" height="6" rx="2" fill="${darken(c, .12)}"/>` : ''}`;
};

R.desk = (c, f) => `
  <rect x="26" y="62" width="148" height="11" rx="4" fill="${c}" stroke="${darken(c, .18)}" stroke-width="1"/>
  <rect x="116" y="73" width="52" height="40" rx="4" fill="${darken(c, .06)}" stroke="${darken(c, .18)}" stroke-width="1"/>
  <path d="M122 86h40M122 100h40" stroke="${darken(c, .2)}" stroke-width="1.5"/>
  <rect x="34" y="73" width="7" height="48" rx="2" fill="${f}"/><rect x="162" y="113" width="7" height="8" rx="2" fill="${f}"/>
  <rect x="116" y="113" width="52" height="4" rx="2" fill="${f}"/>`;

R.bed = (c, f, o) => {
  const w = o.king ? 176 : 150, x0 = (200 - w) / 2;
  return `<rect x="${x0}" y="34" width="${w}" height="40" rx="8" fill="${c}" stroke="${darken(c, .16)}" stroke-width="1"/>
  <rect x="${x0 + 8}" y="42" width="${w - 16}" height="26" rx="5" fill="${lighten(c, .08)}"/>
  <rect x="${x0 - 4}" y="72" width="${w + 8}" height="14" rx="4" fill="${lighten(c, .14)}" stroke="${darken(c, .12)}" stroke-width="1"/>
  <rect x="${x0 + 12}" y="62" width="${(w - 36) / 2}" height="16" rx="6" fill="#FBF8F3" stroke="#E3DCD1"/>
  <rect x="${x0 + 24 + (w - 36) / 2}" y="62" width="${(w - 36) / 2}" height="16" rx="6" fill="#FBF8F3" stroke="#E3DCD1"/>
  <rect x="${x0 - 4}" y="86" width="${w + 8}" height="20" rx="4" fill="${mix(c, '#F3EFE8', .55)}" stroke="${darken(c, .1)}" stroke-width="1"/>
  <rect x="${x0 + 2}" y="106" width="7" height="14" rx="2" fill="${f}"/><rect x="${x0 + w - 9}" y="106" width="7" height="14" rx="2" fill="${f}"/>`;
};

R.wardrobe = (c, f, o) => {
  const doors = o.doors || 3, w = 36 + doors * 26, x0 = (200 - w) / 2;
  let d = '';
  for (let i = 0; i < doors; i++) {
    const x = x0 + 6 + i * ((w - 12) / doors);
    const dw = (w - 12) / doors - 4;
    d += `<rect x="${x + 2}" y="26" width="${dw}" height="86" rx="3" fill="${lighten(c, .07)}" stroke="${darken(c, .24)}" stroke-width="1.2"/>
          <rect x="${x + 7}" y="31" width="${dw - 10}" height="76" rx="2" fill="none" stroke="${darken(c, .13)}" stroke-width="1"/>
          <rect x="${x + dw - 7}" y="62" width="3.5" height="16" rx="1.75" fill="${f}"/>`;
  }
  return `<rect x="${x0}" y="20" width="${w}" height="98" rx="5" fill="${darken(c, .08)}"/>${d}
  <rect x="${x0}" y="118" width="${w}" height="6" rx="2" fill="${f}"/>`;
};

R.drawers = (c, f, o) => {
  const w = o.w || 120, n = o.rows || 3, x0 = (200 - w) / 2, top = 118 - 16 - n * 20;
  let d = '';
  for (let i = 0; i < n; i++)
    d += `<rect x="${x0 + 6}" y="${top + 6 + i * 20}" width="${w - 12}" height="16" rx="3" fill="${lighten(c, .07)}" stroke="${darken(c, .18)}" stroke-width="1"/>
          <rect x="${x0 + w / 2 - 9}" y="${top + 12 + i * 20}" width="18" height="3" rx="1.5" fill="${f}"/>`;
  return `<rect x="${x0}" y="${top}" width="${w}" height="${n * 20 + 12}" rx="4" fill="${darken(c, .07)}"/>${d}
  <rect x="${x0 + 6}" y="${top + n * 20 + 12}" width="7" height="10" rx="2" fill="${f}"/>
  <rect x="${x0 + w - 13}" y="${top + n * 20 + 12}" width="7" height="10" rx="2" fill="${f}"/>`;
};

R.lowUnit = (c, f) => `
  <rect x="22" y="70" width="156" height="40" rx="5" fill="${darken(c, .07)}"/>
  <rect x="28" y="76" width="68" height="28" rx="3" fill="${lighten(c, .07)}" stroke="${darken(c, .18)}" stroke-width="1"/>
  <rect x="104" y="76" width="68" height="28" rx="3" fill="${lighten(c, .07)}" stroke="${darken(c, .18)}" stroke-width="1"/>
  <rect x="52" y="88" width="20" height="3" rx="1.5" fill="${f}"/><rect x="128" y="88" width="20" height="3" rx="1.5" fill="${f}"/>
  <rect x="30" y="110" width="7" height="10" rx="2" fill="${f}"/><rect x="163" y="110" width="7" height="10" rx="2" fill="${f}"/>`;

R.bookcase = (c, f) => `
  <rect x="58" y="18" width="84" height="100" rx="4" fill="${darken(c, .08)}"/>
  <rect x="63" y="23" width="74" height="90" fill="${lighten(c, .12)}"/>
  <path d="M63 46h74M63 69h74M63 92h74" stroke="${darken(c, .16)}" stroke-width="2.5"/>
  <rect x="68" y="30" width="5" height="16" fill="#7D8FA3"/><rect x="75" y="33" width="4" height="13" fill="#B7A78F"/>
  <rect x="81" y="28" width="6" height="18" fill="#9BA98F"/>
  <rect x="112" y="55" width="20" height="14" rx="2" fill="${mix(c, '#B7A78F', .6)}"/>
  <rect x="68" y="78" width="5" height="14" fill="#A3836B"/><rect x="75" y="75" width="4" height="17" fill="#7D8FA3"/>
  <rect x="60" y="118" width="80" height="5" rx="2" fill="${f}"/>`;

R.cabinet = (c, f) => `
  <rect x="52" y="34" width="96" height="84" rx="5" fill="${darken(c, .07)}"/>
  <rect x="58" y="40" width="40" height="72" rx="3" fill="${lighten(c, .07)}" stroke="${darken(c, .18)}" stroke-width="1"/>
  <rect x="102" y="40" width="40" height="72" rx="3" fill="${lighten(c, .07)}" stroke="${darken(c, .18)}" stroke-width="1"/>
  <rect x="92" y="70" width="3" height="14" rx="1.5" fill="${f}"/><rect x="105" y="70" width="3" height="14" rx="1.5" fill="${f}"/>
  <rect x="54" y="118" width="7" height="8" rx="2" fill="${f}"/><rect x="139" y="118" width="7" height="8" rx="2" fill="${f}"/>`;

R.floorLamp = (c, f) => `
  <defs><linearGradient id="fl${++uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lighten(c, .3)}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs>
  <path d="M74 20h52l10 36H64z" fill="url(#fl${uid})" stroke="${darken(c, .2)}" stroke-width="1"/>
  <ellipse cx="100" cy="58" rx="36" ry="5" fill="#F6E7C4" opacity=".7"/>
  <rect x="97" y="56" width="6" height="56" rx="3" fill="${f}"/>
  <ellipse cx="100" cy="116" rx="26" ry="6" fill="${f}"/>`;

R.tableLamp = (c, f) => `
  <path d="M76 42h48l10 28H66z" fill="${lighten(c, .18)}" stroke="${darken(c, .2)}" stroke-width="1"/>
  <ellipse cx="100" cy="72" rx="34" ry="4" fill="#F6E7C4" opacity=".7"/>
  <rect x="96" y="70" width="8" height="26" rx="3" fill="${f}"/>
  <path d="M82 118c0-14 8-22 18-22s18 8 18 22z" fill="${c}" stroke="${darken(c, .2)}" stroke-width="1"/>`;

R.taskLamp = (c, f) => `
  <path d="M60 116V86l22-26" stroke="${f}" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M82 60l26 10" stroke="${f}" stroke-width="5" stroke-linecap="round"/>
  <path d="M104 56l24 10-12 24-22-12z" fill="${c}" stroke="${darken(c, .2)}" stroke-width="1"/>
  <ellipse cx="110" cy="92" rx="14" ry="5" fill="#F6E7C4" opacity=".75"/>
  <ellipse cx="60" cy="118" rx="24" ry="6" fill="${f}"/>`;

R.pendant = (c, f) => `
  <path d="M100 8v26" stroke="${f}" stroke-width="2.5"/>
  <path d="M62 86c0-24 17-52 38-52s38 28 38 52z" fill="${c}" stroke="${darken(c, .2)}" stroke-width="1"/>
  <ellipse cx="100" cy="86" rx="38" ry="7" fill="${lighten(c, .25)}"/>
  <ellipse cx="100" cy="96" rx="22" ry="7" fill="#F6E7C4" opacity=".65"/>`;

R.chandelier = (c, f) => `
  <path d="M100 8v22" stroke="${f}" stroke-width="2.5"/>
  <path d="M54 44h92" stroke="${f}" stroke-width="3" stroke-linecap="round"/>
  <path d="M100 30v14M62 44v16M84 44v24M116 44v24M138 44v16" stroke="${f}" stroke-width="2.5"/>
  ${[62, 84, 116, 138].map((x, i) => `<ellipse cx="${x}" cy="${[62, 70, 70, 62][i]}" rx="9" ry="12" fill="${lighten(c, .3)}" stroke="${darken(c, .15)}"/>`).join('')}
  <ellipse cx="100" cy="92" rx="44" ry="9" fill="#F6E7C4" opacity=".5"/>`;

R.wallLight = (c, f) => `
  <rect x="58" y="40" width="10" height="46" rx="4" fill="${f}"/>
  <path d="M68 52h38l10 26H60z" fill="${c}" stroke="${darken(c, .2)}" stroke-width="1"/>
  <ellipse cx="88" cy="80" rx="28" ry="5" fill="#F6E7C4" opacity=".7"/>`;

R.rug = (c, f, o) => {
  const w = 164, h = o.square ? 90 : 76, x0 = (200 - w) / 2, y0 = 118 - h;
  return `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="3" fill="${c}"/>
  <rect x="${x0 + 9}" y="${y0 + 9}" width="${w - 18}" height="${h - 18}" rx="2" fill="none" stroke="${lighten(c, .3)}" stroke-width="2.5"/>
  <rect x="${x0 + 22}" y="${y0 + 22}" width="${w - 44}" height="${h - 44}" rx="2" fill="${lighten(c, .12)}"/>
  <path d="M${x0 + 34} ${y0 + h / 2}h${w - 68}" stroke="${darken(c, .1)}" stroke-width="2" stroke-dasharray="7 6"/>
  <path d="${Array.from({ length: 17 }, (_, i) => `M${x0 + 4 + i * ((w - 8) / 16)} ${y0 + h}v6`).join('')}" stroke="${lighten(c, .25)}" stroke-width="1.6"/>`;
};

R.cushion = (c) => `
  <rect x="62" y="48" width="76" height="70" rx="12" fill="${c}" stroke="${darken(c, .16)}" stroke-width="1"/>
  <rect x="72" y="58" width="56" height="50" rx="8" fill="none" stroke="${lighten(c, .25)}" stroke-width="1.5"/>`;

R.throw = (c) => `
  <path d="M38 54c26-10 98-10 124 0v22c-26 10-98 10-124 0z" fill="${darken(c, .1)}" stroke="${darken(c, .22)}" stroke-width="1"/>
  <path d="M38 76c26-10 98-10 124 0v22c-26 10-98 10-124 0z" fill="${c}" stroke="${darken(c, .22)}" stroke-width="1"/>
  <path d="M38 98c26-10 98-10 124 0v16c-26 10-98 10-124 0z" fill="${lighten(c, .14)}" stroke="${darken(c, .2)}" stroke-width="1"/>
  <path d="M58 58v20M84 56v22M116 56v22M142 58v20" stroke="${darken(c, .16)}" stroke-width="1.3" opacity=".7"/>
  <path d="M46 102l6 12M154 102l-6 12" stroke="${darken(c, .18)}" stroke-width="1.5" stroke-linecap="round"/>`;

R.wallArt = (c, f) => `
  <rect x="52" y="20" width="96" height="100" rx="3" fill="${f}"/>
  <rect x="59" y="27" width="82" height="86" fill="#FBF9F5"/>
  <circle cx="86" cy="58" r="17" fill="${c}" opacity=".85"/>
  <path d="M59 96l26-28 20 20 16-14 20 18v21H59z" fill="${lighten(c, .18)}"/>
  <path d="M112 44h22" stroke="${darken(c, .1)}" stroke-width="2.5"/>`;

R.mirror = (c, f) => `
  <defs><linearGradient id="mr${++uid}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#F3F6F8"/><stop offset=".45" stop-color="#DCE5EA"/><stop offset=".5" stop-color="#F7FAFC"/><stop offset="1" stop-color="#D4DDE3"/></linearGradient></defs>
  <rect x="62" y="14" width="76" height="106" rx="38" fill="${f}"/>
  <rect x="69" y="21" width="62" height="92" rx="31" fill="url(#mr${uid})"/>
  <path d="M82 90l24-38 10 16" stroke="#FFFFFF" stroke-width="2" opacity=".6" fill="none"/>`;

R.vase = (c, f) => `
  <path d="M100 54c0-16-7-27-19-33" stroke="#7F9472" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  <path d="M100 54c1-14 8-23 19-27" stroke="#6E8168" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  <ellipse cx="79" cy="20" rx="8" ry="5" transform="rotate(-32 79 20)" fill="#7F9472"/>
  <ellipse cx="120" cy="25" rx="8" ry="5" transform="rotate(30 120 25)" fill="#8EA081"/>
  <path d="M90 52h20l3 10c7 9 11 20 11 30 0 15-11 26-24 26s-24-11-24-26c0-10 4-21 11-30z"
        fill="${c}" stroke="${darken(c, .2)}" stroke-width="1"/>
  <ellipse cx="100" cy="52" rx="10" ry="3.2" fill="${darken(c, .14)}"/>
  <path d="M88 78c-5 9-7 19-5 28" stroke="${lighten(c, .34)}" stroke-width="3" fill="none" opacity=".8" stroke-linecap="round"/>`;

R.decor = (c, f) => `
  <ellipse cx="100" cy="118" rx="30" ry="6" fill="${f}"/>
  <rect x="78" y="108" width="44" height="10" rx="3" fill="${darken(f, .12)}"/>
  <path d="M100 108c-22 0-30-18-30-34S84 40 100 40s30 18 30 34-8 34-30 34z"
        fill="none" stroke="${c}" stroke-width="11" stroke-linecap="round"/>
  <path d="M100 96c-13 0-18-10-18-20s7-18 18-18" fill="none" stroke="${lighten(c, .25)}" stroke-width="7" stroke-linecap="round"/>`;

R.planter = (c, f) => `
  <path d="M100 68c-4-20 6-34 20-38 2 18-6 32-20 38zM100 70c-6-16-18-24-30-24 2 16 14 26 30 24z" fill="#7F9472"/>
  <path d="M100 72c2-18 12-28 24-30" stroke="#6B7F63" stroke-width="2" fill="none"/>
  <path d="M76 72h48l-7 48H83z" fill="${c}" stroke="${darken(c, .18)}" stroke-width="1"/>
  <path d="M76 72h48l-1.5 10H77.5z" fill="${lighten(c, .15)}"/>`;

R.tv = (c, f) => `
  <rect x="22" y="76" width="156" height="34" rx="5" fill="${darken(c, .07)}"/>
  <rect x="28" y="82" width="46" height="22" rx="3" fill="${lighten(c, .08)}" stroke="${darken(c, .18)}" stroke-width="1"/>
  <rect x="78" y="82" width="44" height="22" rx="3" fill="${darken(c, .12)}"/>
  <rect x="126" y="82" width="46" height="22" rx="3" fill="${lighten(c, .08)}" stroke="${darken(c, .18)}" stroke-width="1"/>
  <rect x="42" y="91" width="18" height="3" rx="1.5" fill="${f}"/><rect x="140" y="91" width="18" height="3" rx="1.5" fill="${f}"/>
  <rect x="58" y="34" width="84" height="42" rx="3" fill="#2A3138"/><rect x="63" y="39" width="74" height="32" rx="2" fill="#39434C"/>
  <rect x="26" y="110" width="7" height="9" rx="2" fill="${f}"/><rect x="167" y="110" width="7" height="9" rx="2" fill="${f}"/>`;

/* ---------- Type → renderer map ---------- */
const MAP = {
  'Sofa': (p, c, f) => R.sofa(c, f, { seats: p.attrs.seats || 3 }),
  'Accent Chair': (p, c, f) => R.armchair(c, f),
  'Dining Chair': (p, c, f) => R.diningChair(c, f),
  'Office Chair': (p, c, f) => R.officeChair(c, f),
  'Bench': (p, c, f) => R.bench(c, f),
  'Coffee Table': (p, c, f) => R.table(c, f, { w: 150, legH: 24, th: 12, shelf: true }),
  'Side Table': (p, c, f) => R.table(c, f, { w: 74, legH: 58, th: 9, legW: 6 }),
  'Console Table': (p, c, f) => R.table(c, f, { w: 170, legH: 54, th: 9, legW: 6 }),
  'Dining Table': (p, c, f) => R.table(c, f, { w: 176, legH: 50, th: 14, legW: 10, apron: true }),
  'Desk': (p, c, f) => R.desk(c, f),
  'Bed': (p, c, f) => R.bed(c, f, { king: /King/.test(p.attrs.bedSize || '') }),
  'Wardrobe': (p, c, f) => R.wardrobe(c, f, { doors: { Small: 2, Medium: 3, Large: 4 }[p.attrs.doorGroup] || 3 }),
  'Bedside Table': (p, c, f) => R.drawers(c, f, { w: 72, rows: 2 }),
  'Chest of Drawers': (p, c, f) => R.drawers(c, f, { w: 122, rows: 3 }),
  'TV Unit': (p, c, f) => R.tv(c, f),
  'Sideboard': (p, c, f) => R.lowUnit(c, f),
  'Bookcase': (p, c, f) => R.bookcase(c, f),
  'Storage Cabinet': (p, c, f) => R.cabinet(c, f),
  'Floor Lamp': (p, c, f) => R.floorLamp(c, f),
  'Table Lamp': (p, c, f) => R.tableLamp(c, f),
  'Task Lamp': (p, c, f) => R.taskLamp(c, f),
  'Pendant Light': (p, c, f) => R.pendant(c, f),
  'Chandelier': (p, c, f) => R.chandelier(c, f),
  'Wall Light': (p, c, f) => R.wallLight(c, f),
  'Rug': (p, c, f) => R.rug(c, f, {}),
  'Cushion': (p, c) => R.cushion(c),
  'Throw': (p, c) => R.throw(c),
  'Wall Art': (p, c, f) => R.wallArt(c, f),
  'Mirror': (p, c, f) => R.mirror(c, f),
  'Vase': (p, c, f) => R.vase(c, f),
  'Decorative Object': (p, c, f) => R.decor(c, f),
  'Planter': (p, c, f) => R.planter(c, f)
};

/** Drawn product image for one canonical product (AID). */
export function productArt(product) {
  const c = bodyTone(product), f = frameTone(product);
  const draw = MAP[product.type] || R.cabinet;
  const shadowByType = {
    'Wall Art': [0, 0, 0, 0], 'Mirror': [100, 124, 40, 5], 'Pendant Light': [0, 0, 0, 0],
    'Chandelier': [0, 0, 0, 0], 'Wall Light': [0, 0, 0, 0], 'Rug': [100, 120, 84, 5],
    'Cushion': [100, 122, 42, 5], 'Throw': [100, 108, 56, 5]
  };
  return scene(draw(product, c, f), {
    shadow: shadowByType[product.type] || [100, 126, 68, 7],
    label: `${product.name}, ${product.primaryColour} ${product.material}`
  });
}

/* ============================================================
   Measured plan — the same composition seen from above, drawn from
   real widths and depths so fit is visible, not asserted.
   ============================================================ */
const PLAN = {};
PLAN.sofa = (x, y, w, h, c, f) => {
  const seats = Math.max(2, Math.round(w / 85));
  let cu = '';
  for (let i = 0; i < seats; i++)
    cu += `<rect x="${x + 7 + i * ((w - 14) / seats) + 1.5}" y="${y + h * .34}" width="${(w - 14) / seats - 3}" height="${h * .58}" rx="3" fill="${lighten(c, .14)}" stroke="${darken(c, .14)}" stroke-width=".8"/>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="${c}" stroke="${darken(c, .2)}" stroke-width="1"/>
    <rect x="${x + 7}" y="${y + 4}" width="${w - 14}" height="${h * .3}" rx="3" fill="${darken(c, .08)}"/>${cu}`;
};
PLAN.bed = (x, y, w, h, c) => `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${mix(c, '#F6F2EC', .5)}" stroke="${darken(c, .2)}" stroke-width="1"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h * .13}" rx="3" fill="${c}"/>
  <rect x="${x + w * .08}" y="${y + h * .16}" width="${w * .38}" height="${h * .17}" rx="4" fill="#FFFFFF" stroke="#E0D9CE"/>
  <rect x="${x + w * .54}" y="${y + h * .16}" width="${w * .38}" height="${h * .17}" rx="4" fill="#FFFFFF" stroke="#E0D9CE"/>
  <path d="M${x} ${y + h * .55}h${w}" stroke="${darken(c, .12)}" stroke-width="1.2"/>`;
PLAN.table = (x, y, w, h, c) => `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${c}" stroke="${darken(c, .22)}" stroke-width="1"/>
  <rect x="${x + 5}" y="${y + 5}" width="${w - 10}" height="${h - 10}" rx="3" fill="none" stroke="${lighten(c, .22)}" stroke-width="1"/>`;
PLAN.chair = (x, y, w, h, c) => `
  <rect x="${x}" y="${y + h * .22}" width="${w}" height="${h * .78}" rx="3" fill="${lighten(c, .1)}" stroke="${darken(c, .2)}" stroke-width=".8"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h * .22}" rx="2" fill="${c}"/>`;
PLAN.storage = (x, y, w, h, c, f, n = 3) => {
  let d = '';
  for (let i = 1; i < n; i++) d += `<path d="M${x + (w / n) * i} ${y}v${h}" stroke="${darken(c, .18)}" stroke-width="1"/>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${c}" stroke="${darken(c, .22)}" stroke-width="1"/>${d}
    <path d="M${x} ${y + h}h${w}" stroke="${darken(c, .25)}" stroke-width="1.4"/>`;
};
PLAN.rug = (x, y, w, h, c) => `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${c}" opacity=".55"/>
  <rect x="${x + 8}" y="${y + 8}" width="${w - 16}" height="${h - 16}" rx="2" fill="none" stroke="${lighten(c, .3)}" stroke-width="2"/>`;
PLAN.lamp = (x, y, w, h, c) => `
  <circle cx="${x + w / 2}" cy="${y + h / 2}" r="${w / 2 + 7}" fill="#F6E7C4" opacity=".4"/>
  <circle cx="${x + w / 2}" cy="${y + h / 2}" r="${w / 2}" fill="${c}" stroke="${darken(c, .2)}" stroke-width="1"/>`;
PLAN.plant = (x, y, w, h, c) => `
  <circle cx="${x + w / 2}" cy="${y + h / 2}" r="${w / 2}" fill="#7F9472" opacity=".65"/>
  <circle cx="${x + w / 2}" cy="${y + h / 2}" r="${w / 3.4}" fill="${c}"/>`;
PLAN.wall = (x, y, w, c) => `<rect x="${x}" y="${y}" width="${w}" height="7" rx="2" fill="${c}" stroke="${darken(c, .2)}" stroke-width=".8"/>`;

export function planGlyph(type, x, y, w, h, product) {
  const c = bodyTone(product), f = frameTone(product);
  switch (type) {
    case 'Sofa': return PLAN.sofa(x, y, w, h, c, f);
    case 'Bed': return PLAN.bed(x, y, w, h, c);
    case 'Rug': return PLAN.rug(x, y, w, h, c);
    case 'Dining Table': case 'Coffee Table': case 'Side Table':
    case 'Console Table': case 'Desk': return PLAN.table(x, y, w, h, c);
    case 'Dining Chair': case 'Accent Chair': case 'Office Chair':
    case 'Bench': return PLAN.chair(x, y, w, h, c);
    case 'Floor Lamp': case 'Table Lamp': case 'Task Lamp':
    case 'Pendant Light': case 'Chandelier': return PLAN.lamp(x, y, w, h, c);
    case 'Planter': case 'Vase': case 'Decorative Object': return PLAN.plant(x, y, w, h, c);
    case 'Wall Art': case 'Mirror': case 'Wall Light': return PLAN.wall(x, y, w, c);
    default: return PLAN.storage(x, y, w, h, c, f,
      { 'Wardrobe': 3, 'Chest of Drawers': 3, 'TV Unit': 3, 'Sideboard': 2, 'Bookcase': 4, 'Bedside Table': 1, 'Storage Cabinet': 2 }[type] || 2);
  }
}
