import { art, darkenHex as darken, lightenHex as lighten, mixHex as mix } from '@aidooi/ui-tokens';

/** The product record fields a drawing is made from. Nothing else is drawn. */
export interface ArtProduct {
  readonly type: string;
  readonly primaryColour: string;
  readonly material: string;
  readonly widthCm: number;
  readonly depthCm: number;
  readonly heightCm: number;
  readonly name?: string;
}

interface Opts {
  seats: number;
  w: number;
  legH: number;
  th: number;
  legW: number;
  rows: number;
  doors: number;
  shelf: boolean;
  apron: boolean;
  king: boolean;
  square: boolean;
}
const DEFAULTS: Opts = {
  seats: 3, w: 120, legH: 24, th: 11, legW: 7, rows: 3, doors: 3,
  shelf: false, apron: false, king: false, square: false,
};
type Draw = (c: string, f: string, o: Opts) => string;

let uid = 0;
const nextId = (): number => ++uid;

export const bodyTone = (p: Pick<ArtProduct, 'primaryColour'>): string =>
  (art.tone as Record<string, string>)[p.primaryColour] ?? art.fallbackTone;
export const frameTone = (p: Pick<ArtProduct, 'material'>): string =>
  (art.frame as Record<string, string>)[p.material] ?? art.fallbackFrame;

const R: Record<string, Draw> = {};

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

R.armchair = (c, f, o) => `
  <rect x="62" y="40" width="76" height="42" rx="10" fill="${darken(c, .08)}"/>
  <rect x="68" y="44" width="64" height="34" rx="7" fill="${c}" stroke="${darken(c, .16)}" stroke-width="1"/>
  <rect x="62" y="76" width="76" height="28" rx="7" fill="${darken(c, .05)}"/>
  <rect x="70" y="80" width="60" height="21" rx="5" fill="${lighten(c, .1)}" stroke="${darken(c, .14)}" stroke-width="1"/>
  <rect x="56" y="56" width="14" height="48" rx="6" fill="${lighten(c, .05)}" stroke="${darken(c, .16)}" stroke-width="1"/>
  <rect x="130" y="56" width="14" height="48" rx="6" fill="${lighten(c, .05)}" stroke="${darken(c, .16)}" stroke-width="1"/>
  <path d="M62 104l-6 17M138 104l6 17" stroke="${f}" stroke-width="5" stroke-linecap="round"/>`;

R.diningChair = (c, f, o) => `
  <rect x="80" y="30" width="40" height="46" rx="7" fill="${c}" stroke="${darken(c, .18)}" stroke-width="1"/>
  <path d="M88 40h24M88 52h24" stroke="${darken(c, .18)}" stroke-width="1.5" stroke-linecap="round"/>
  <rect x="72" y="76" width="56" height="12" rx="4" fill="${lighten(c, .08)}" stroke="${darken(c, .18)}" stroke-width="1"/>
  <path d="M76 88l-4 32M124 88l4 32M84 88l2 32M116 88l-2 32" stroke="${f}" stroke-width="4" stroke-linecap="round"/>`;

R.officeChair = (c, f, o) => `
  <rect x="78" y="26" width="44" height="46" rx="10" fill="${c}" stroke="${darken(c, .18)}" stroke-width="1"/>
  <rect x="84" y="34" width="32" height="30" rx="6" fill="${lighten(c, .09)}"/>
  <rect x="70" y="72" width="60" height="13" rx="5" fill="${lighten(c, .05)}" stroke="${darken(c, .18)}" stroke-width="1"/>
  <rect x="96" y="85" width="8" height="18" rx="3" fill="${f}"/>
  <path d="M100 103l-28 14M100 103l28 14M100 103v16" stroke="${f}" stroke-width="4" stroke-linecap="round"/>
  <circle cx="71" cy="120" r="5" fill="${darken(f, .2)}"/><circle cx="129" cy="120" r="5" fill="${darken(f, .2)}"/><circle cx="100" cy="123" r="5" fill="${darken(f, .2)}"/>`;

R.bench = (c, f, o) => `
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

R.desk = (c, f, o) => `
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
  <rect x="${x0 + 12}" y="62" width="${(w - 36) / 2}" height="16" rx="6" fill="${art.pillow}" stroke="${art.pillowEdge}"/>
  <rect x="${x0 + 24 + (w - 36) / 2}" y="62" width="${(w - 36) / 2}" height="16" rx="6" fill="${art.pillow}" stroke="${art.pillowEdge}"/>
  <rect x="${x0 - 4}" y="86" width="${w + 8}" height="20" rx="4" fill="${mix(c, art.sheet, .55)}" stroke="${darken(c, .1)}" stroke-width="1"/>
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

R.lowUnit = (c, f, o) => `
  <rect x="22" y="70" width="156" height="40" rx="5" fill="${darken(c, .07)}"/>
  <rect x="28" y="76" width="68" height="28" rx="3" fill="${lighten(c, .07)}" stroke="${darken(c, .18)}" stroke-width="1"/>
  <rect x="104" y="76" width="68" height="28" rx="3" fill="${lighten(c, .07)}" stroke="${darken(c, .18)}" stroke-width="1"/>
  <rect x="52" y="88" width="20" height="3" rx="1.5" fill="${f}"/><rect x="128" y="88" width="20" height="3" rx="1.5" fill="${f}"/>
  <rect x="30" y="110" width="7" height="10" rx="2" fill="${f}"/><rect x="163" y="110" width="7" height="10" rx="2" fill="${f}"/>`;

R.bookcase = (c, f, o) => `
  <rect x="58" y="18" width="84" height="100" rx="4" fill="${darken(c, .08)}"/>
  <rect x="63" y="23" width="74" height="90" fill="${lighten(c, .12)}"/>
  <path d="M63 46h74M63 69h74M63 92h74" stroke="${darken(c, .16)}" stroke-width="2.5"/>
  <rect x="68" y="30" width="5" height="16" fill="${art.bookA}"/><rect x="75" y="33" width="4" height="13" fill="${art.bookB}"/>
  <rect x="81" y="28" width="6" height="18" fill="${art.bookC}"/>
  <rect x="112" y="55" width="20" height="14" rx="2" fill="${mix(c, art.bookB, .6)}"/>
  <rect x="68" y="78" width="5" height="14" fill="${art.bookD}"/><rect x="75" y="75" width="4" height="17" fill="${art.bookA}"/>
  <rect x="60" y="118" width="80" height="5" rx="2" fill="${f}"/>`;

R.cabinet = (c, f, o) => `
  <rect x="52" y="34" width="96" height="84" rx="5" fill="${darken(c, .07)}"/>
  <rect x="58" y="40" width="40" height="72" rx="3" fill="${lighten(c, .07)}" stroke="${darken(c, .18)}" stroke-width="1"/>
  <rect x="102" y="40" width="40" height="72" rx="3" fill="${lighten(c, .07)}" stroke="${darken(c, .18)}" stroke-width="1"/>
  <rect x="92" y="70" width="3" height="14" rx="1.5" fill="${f}"/><rect x="105" y="70" width="3" height="14" rx="1.5" fill="${f}"/>
  <rect x="54" y="118" width="7" height="8" rx="2" fill="${f}"/><rect x="139" y="118" width="7" height="8" rx="2" fill="${f}"/>`;

R.floorLamp = (c, f) => {
  const id = nextId();
  return `
  <defs><linearGradient id="fl${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lighten(c, .3)}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs>
  <path d="M74 20h52l10 36H64z" fill="url(#fl${id})" stroke="${darken(c, .2)}" stroke-width="1"/>
  <ellipse cx="100" cy="58" rx="36" ry="5" fill="${art.glow}" opacity=".7"/>
  <rect x="97" y="56" width="6" height="56" rx="3" fill="${f}"/>
  <ellipse cx="100" cy="116" rx="26" ry="6" fill="${f}"/>`;
}

R.tableLamp = (c, f, o) => `
  <path d="M76 42h48l10 28H66z" fill="${lighten(c, .18)}" stroke="${darken(c, .2)}" stroke-width="1"/>
  <ellipse cx="100" cy="72" rx="34" ry="4" fill="${art.glow}" opacity=".7"/>
  <rect x="96" y="70" width="8" height="26" rx="3" fill="${f}"/>
  <path d="M82 118c0-14 8-22 18-22s18 8 18 22z" fill="${c}" stroke="${darken(c, .2)}" stroke-width="1"/>`;

R.taskLamp = (c, f, o) => `
  <path d="M60 116V86l22-26" stroke="${f}" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M82 60l26 10" stroke="${f}" stroke-width="5" stroke-linecap="round"/>
  <path d="M104 56l24 10-12 24-22-12z" fill="${c}" stroke="${darken(c, .2)}" stroke-width="1"/>
  <ellipse cx="110" cy="92" rx="14" ry="5" fill="${art.glow}" opacity=".75"/>
  <ellipse cx="60" cy="118" rx="24" ry="6" fill="${f}"/>`;

R.pendant = (c, f, o) => `
  <path d="M100 8v26" stroke="${f}" stroke-width="2.5"/>
  <path d="M62 86c0-24 17-52 38-52s38 28 38 52z" fill="${c}" stroke="${darken(c, .2)}" stroke-width="1"/>
  <ellipse cx="100" cy="86" rx="38" ry="7" fill="${lighten(c, .25)}"/>
  <ellipse cx="100" cy="96" rx="22" ry="7" fill="${art.glow}" opacity=".65"/>`;

R.chandelier = (c, f, o) => `
  <path d="M100 8v22" stroke="${f}" stroke-width="2.5"/>
  <path d="M54 44h92" stroke="${f}" stroke-width="3" stroke-linecap="round"/>
  <path d="M100 30v14M62 44v16M84 44v24M116 44v24M138 44v16" stroke="${f}" stroke-width="2.5"/>
  ${[62, 84, 116, 138].map((x, i) => `<ellipse cx="${x}" cy="${[62, 70, 70, 62][i]}" rx="9" ry="12" fill="${lighten(c, .3)}" stroke="${darken(c, .15)}"/>`).join('')}
  <ellipse cx="100" cy="92" rx="44" ry="9" fill="${art.glow}" opacity=".5"/>`;

R.wallLight = (c, f, o) => `
  <rect x="58" y="40" width="10" height="46" rx="4" fill="${f}"/>
  <path d="M68 52h38l10 26H60z" fill="${c}" stroke="${darken(c, .2)}" stroke-width="1"/>
  <ellipse cx="88" cy="80" rx="28" ry="5" fill="${art.glow}" opacity=".7"/>`;

R.rug = (c, f, o) => {
  const w = 164, h = o.square ? 90 : 76, x0 = (200 - w) / 2, y0 = 118 - h;
  return `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="3" fill="${c}"/>
  <rect x="${x0 + 9}" y="${y0 + 9}" width="${w - 18}" height="${h - 18}" rx="2" fill="none" stroke="${lighten(c, .3)}" stroke-width="2.5"/>
  <rect x="${x0 + 22}" y="${y0 + 22}" width="${w - 44}" height="${h - 44}" rx="2" fill="${lighten(c, .12)}"/>
  <path d="M${x0 + 34} ${y0 + h / 2}h${w - 68}" stroke="${darken(c, .1)}" stroke-width="2" stroke-dasharray="7 6"/>
  <path d="${Array.from({ length: 17 }, (_, i) => `M${x0 + 4 + i * ((w - 8) / 16)} ${y0 + h}v6`).join('')}" stroke="${lighten(c, .25)}" stroke-width="1.6"/>`;
};

R.cushion = (c, f, o) => `
  <rect x="62" y="48" width="76" height="70" rx="12" fill="${c}" stroke="${darken(c, .16)}" stroke-width="1"/>
  <rect x="72" y="58" width="56" height="50" rx="8" fill="none" stroke="${lighten(c, .25)}" stroke-width="1.5"/>`;

R.throw = (c, f, o) => `
  <path d="M38 54c26-10 98-10 124 0v22c-26 10-98 10-124 0z" fill="${darken(c, .1)}" stroke="${darken(c, .22)}" stroke-width="1"/>
  <path d="M38 76c26-10 98-10 124 0v22c-26 10-98 10-124 0z" fill="${c}" stroke="${darken(c, .22)}" stroke-width="1"/>
  <path d="M38 98c26-10 98-10 124 0v16c-26 10-98 10-124 0z" fill="${lighten(c, .14)}" stroke="${darken(c, .2)}" stroke-width="1"/>
  <path d="M58 58v20M84 56v22M116 56v22M142 58v20" stroke="${darken(c, .16)}" stroke-width="1.3" opacity=".7"/>
  <path d="M46 102l6 12M154 102l-6 12" stroke="${darken(c, .18)}" stroke-width="1.5" stroke-linecap="round"/>`;

R.wallArt = (c, f, o) => `
  <rect x="52" y="20" width="96" height="100" rx="3" fill="${f}"/>
  <rect x="59" y="27" width="82" height="86" fill="${art.canvas}"/>
  <circle cx="86" cy="58" r="17" fill="${c}" opacity=".85"/>
  <path d="M59 96l26-28 20 20 16-14 20 18v21H59z" fill="${lighten(c, .18)}"/>
  <path d="M112 44h22" stroke="${darken(c, .1)}" stroke-width="2.5"/>`;

R.mirror = (c, f) => {
  const id = nextId();
  return `
  <defs><linearGradient id="mr${id}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${art.glassA}"/><stop offset=".45" stop-color="${art.glassB}"/><stop offset=".5" stop-color="${art.glassC}"/><stop offset="1" stop-color="${art.glassD}"/></linearGradient></defs>
  <rect x="62" y="14" width="76" height="106" rx="38" fill="${f}"/>
  <rect x="69" y="21" width="62" height="92" rx="31" fill="url(#mr${id})"/>
  <path d="M82 90l24-38 10 16" stroke="${art.white}" stroke-width="2" opacity=".6" fill="none"/>`;
}

R.vase = (c, f, o) => `
  <path d="M100 54c0-16-7-27-19-33" stroke="${art.leaf}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  <path d="M100 54c1-14 8-23 19-27" stroke="${art.leafDark}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  <ellipse cx="79" cy="20" rx="8" ry="5" transform="rotate(-32 79 20)" fill="${art.leaf}"/>
  <ellipse cx="120" cy="25" rx="8" ry="5" transform="rotate(30 120 25)" fill="${art.leafLight}"/>
  <path d="M90 52h20l3 10c7 9 11 20 11 30 0 15-11 26-24 26s-24-11-24-26c0-10 4-21 11-30z"
        fill="${c}" stroke="${darken(c, .2)}" stroke-width="1"/>
  <ellipse cx="100" cy="52" rx="10" ry="3.2" fill="${darken(c, .14)}"/>
  <path d="M88 78c-5 9-7 19-5 28" stroke="${lighten(c, .34)}" stroke-width="3" fill="none" opacity=".8" stroke-linecap="round"/>`;

R.decor = (c, f, o) => `
  <ellipse cx="100" cy="118" rx="30" ry="6" fill="${f}"/>
  <rect x="78" y="108" width="44" height="10" rx="3" fill="${darken(f, .12)}"/>
  <path d="M100 108c-22 0-30-18-30-34S84 40 100 40s30 18 30 34-8 34-30 34z"
        fill="none" stroke="${c}" stroke-width="11" stroke-linecap="round"/>
  <path d="M100 96c-13 0-18-10-18-20s7-18 18-18" fill="none" stroke="${lighten(c, .25)}" stroke-width="7" stroke-linecap="round"/>`;

R.planter = (c, f, o) => `
  <path d="M100 68c-4-20 6-34 20-38 2 18-6 32-20 38zM100 70c-6-16-18-24-30-24 2 16 14 26 30 24z" fill="${art.leaf}"/>
  <path d="M100 72c2-18 12-28 24-30" stroke="${art.leafDeep}" stroke-width="2" fill="none"/>
  <path d="M76 72h48l-7 48H83z" fill="${c}" stroke="${darken(c, .18)}" stroke-width="1"/>
  <path d="M76 72h48l-1.5 10H77.5z" fill="${lighten(c, .15)}"/>`;

R.tv = (c, f, o) => `
  <rect x="22" y="76" width="156" height="34" rx="5" fill="${darken(c, .07)}"/>
  <rect x="28" y="82" width="46" height="22" rx="3" fill="${lighten(c, .08)}" stroke="${darken(c, .18)}" stroke-width="1"/>
  <rect x="78" y="82" width="44" height="22" rx="3" fill="${darken(c, .12)}"/>
  <rect x="126" y="82" width="46" height="22" rx="3" fill="${lighten(c, .08)}" stroke="${darken(c, .18)}" stroke-width="1"/>
  <rect x="42" y="91" width="18" height="3" rx="1.5" fill="${f}"/><rect x="140" y="91" width="18" height="3" rx="1.5" fill="${f}"/>
  <rect x="58" y="34" width="84" height="42" rx="3" fill="${art.screen}"/><rect x="63" y="39" width="74" height="32" rx="2" fill="${art.screenLight}"/>
  <rect x="26" y="110" width="7" height="9" rx="2" fill="${f}"/><rect x="167" y="110" width="7" height="9" rx="2" fill="${f}"/>`;


/**
 * Nominal drawn size (cm) of each type's illustration. The real record's width:height is compared with
 * it and the drawing is stretched toward the truth, within a limit that keeps the piece recognisable.
 */
const NOMINAL: Record<string, readonly [number, number]> = {
  Sofa: [200, 85], 'Accent Chair': [80, 85], 'Dining Chair': [45, 90], 'Office Chair': [60, 100],
  Bench: [120, 45], 'Coffee Table': [110, 42], 'Side Table': [50, 55], 'Console Table': [120, 80],
  'Dining Table': [180, 76], Desk: [140, 75], Bed: [170, 110], Wardrobe: [150, 210],
  'Bedside Table': [50, 55], 'Chest of Drawers': [100, 90], 'TV Unit': [160, 55], Sideboard: [160, 80],
  Bookcase: [90, 190], 'Storage Cabinet': [90, 120], 'Floor Lamp': [45, 160], 'Table Lamp': [30, 55],
  'Task Lamp': [35, 50], 'Pendant Light': [45, 40], Chandelier: [70, 60], 'Wall Light': [25, 30],
  Rug: [200, 140], Cushion: [45, 45], Throw: [130, 30], 'Wall Art': [70, 90], Mirror: [60, 120],
  Vase: [25, 40], 'Decorative Object': [30, 35], Planter: [35, 50],
};
const STRETCH_MIN = 0.8;
const STRETCH_MAX = 1.3;

const channels = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** True when two colours are shades of one another: every channel within a lighten/darken step. */
const near = (a: string, b: string): boolean => {
  const [ar, ag, ab] = channels(a) as [number, number, number];
  const [br, bg, bb] = channels(b) as [number, number, number];
  return Math.max(Math.abs(ar - br), Math.abs(ag - bg), Math.abs(ab - bb)) <= 70;
};

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** Horizontal stretch (the vertical is its inverse) that moves the drawing toward the record's real proportions. */
export function proportion(p: Pick<ArtProduct, 'type' | 'widthCm' | 'heightCm'>): number {
  const nominal = NOMINAL[p.type];
  if (!nominal || p.widthCm <= 0 || p.heightCm <= 0) return 1;
  const ratio = p.widthCm / p.heightCm / (nominal[0] / nominal[1]);
  return clamp(Math.sqrt(ratio), STRETCH_MIN, STRETCH_MAX);
}

const SEATS = (p: ArtProduct): number => clamp(Math.round(p.widthCm / 68), 2, 5);
const DOORS = (p: ArtProduct): number => clamp(Math.round(p.widthCm / 48), 2, 4);

const d = (name: string, c: string, f: string, o: Partial<Opts>): string =>
  (R[name] as Draw)(c, f, { ...DEFAULTS, ...o });

const MAP: Record<string, (p: ArtProduct, c: string, f: string) => string> = {
  Sofa: (p, c, f) => d('sofa', c, f, { seats: SEATS(p) }),
  'Accent Chair': (_p, c, f) => d('armchair', c, f, {}),
  'Dining Chair': (_p, c, f) => d('diningChair', c, f, {}),
  'Office Chair': (_p, c, f) => d('officeChair', c, f, {}),
  Bench: (_p, c, f) => d('bench', c, f, {}),
  'Coffee Table': (_p, c, f) => d('table', c, f, { w: 150, legH: 24, th: 12, shelf: true }),
  'Side Table': (_p, c, f) => d('table', c, f, { w: 74, legH: 58, th: 9, legW: 6 }),
  'Console Table': (_p, c, f) => d('table', c, f, { w: 170, legH: 54, th: 9, legW: 6 }),
  'Dining Table': (_p, c, f) => d('table', c, f, { w: 176, legH: 50, th: 14, legW: 10, apron: true }),
  Desk: (_p, c, f) => d('desk', c, f, {}),
  Bed: (p, c, f) => d('bed', c, f, { king: p.widthCm >= 180 }),
  Wardrobe: (p, c, f) => d('wardrobe', c, f, { doors: DOORS(p) }),
  'Bedside Table': (_p, c, f) => d('drawers', c, f, { w: 72, rows: 2 }),
  'Chest of Drawers': (_p, c, f) => d('drawers', c, f, { w: 122, rows: 3 }),
  'TV Unit': (_p, c, f) => d('tv', c, f, {}),
  Sideboard: (_p, c, f) => d('lowUnit', c, f, {}),
  Bookcase: (_p, c, f) => d('bookcase', c, f, {}),
  'Storage Cabinet': (_p, c, f) => d('cabinet', c, f, {}),
  'Floor Lamp': (_p, c, f) => d('floorLamp', c, f, {}),
  'Table Lamp': (_p, c, f) => d('tableLamp', c, f, {}),
  'Task Lamp': (_p, c, f) => d('taskLamp', c, f, {}),
  'Pendant Light': (_p, c, f) => d('pendant', c, f, {}),
  Chandelier: (_p, c, f) => d('chandelier', c, f, {}),
  'Wall Light': (_p, c, f) => d('wallLight', c, f, {}),
  Rug: (_p, c, f) => d('rug', c, f, {}),
  Cushion: (_p, c, f) => d('cushion', c, f, {}),
  Throw: (_p, c, f) => d('throw', c, f, {}),
  'Wall Art': (_p, c, f) => d('wallArt', c, f, {}),
  Mirror: (_p, c, f) => d('mirror', c, f, {}),
  Vase: (_p, c, f) => d('vase', c, f, {}),
  'Decorative Object': (_p, c, f) => d('decor', c, f, {}),
  Planter: (_p, c, f) => d('planter', c, f, {}),
};

/** Every product type the illustration system can draw. */
export const ART_TYPES: readonly string[] = Object.keys(MAP);

/** [cx, cy, rx, ry] of the soft contact shadow; zero width for things that hang. */
const SHADOW: Record<string, readonly [number, number, number, number]> = {
  'Wall Art': [0, 0, 0, 0], Mirror: [100, 124, 40, 5], 'Pendant Light': [0, 0, 0, 0],
  Chandelier: [0, 0, 0, 0], 'Wall Light': [0, 0, 0, 0], Rug: [100, 120, 84, 5],
  Cushion: [100, 122, 42, 5], Throw: [100, 108, 56, 5],
};

/** Surface treatment per material family: what the body fill looks like up close. */
function texture(material: string, base: string, id: string): string {
  const line = darken(base, 0.1);
  const soft = lighten(base, 0.12);
  switch (material) {
    case 'Wood':
      return `<pattern id="${id}" width="40" height="9" patternUnits="userSpaceOnUse"><rect width="40" height="9" fill="${base}"/><path d="M0 2.5c10-2 20 2 40 0M0 6.5c12 2 24-2 40 0" stroke="${line}" stroke-width=".7" fill="none" opacity=".7"/></pattern>`;
    case 'Rattan':
      return `<pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="${base}"/><path d="M0 0l6 6M6 0L0 6" stroke="${line}" stroke-width=".8" opacity=".75"/></pattern>`;
    case 'Fabric':
      return `<pattern id="${id}" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="${base}"/><path d="M0 1h4M1 0v4" stroke="${soft}" stroke-width=".5" opacity=".55"/></pattern>`;
    case 'Leather':
      return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${lighten(base, 0.16)}"/><stop offset=".5" stop-color="${base}"/><stop offset="1" stop-color="${darken(base, 0.1)}"/></linearGradient>`;
    case 'Metal':
      return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${darken(base, 0.08)}"/><stop offset=".35" stop-color="${lighten(base, 0.28)}"/><stop offset=".7" stop-color="${base}"/><stop offset="1" stop-color="${darken(base, 0.12)}"/></linearGradient>`;
    case 'Glass':
      return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${lighten(base, 0.45)}"/><stop offset=".5" stop-color="${lighten(base, 0.12)}"/><stop offset="1" stop-color="${lighten(base, 0.35)}"/></linearGradient>`;
    case 'Stone':
    case 'Ceramic':
      return `<pattern id="${id}" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill="${base}"/><circle cx="3" cy="4" r=".8" fill="${line}" opacity=".5"/><circle cx="10" cy="9" r=".6" fill="${soft}" opacity=".7"/><circle cx="6" cy="12" r=".7" fill="${line}" opacity=".4"/></pattern>`;
    default:
      return '';
  }
}

/**
 * The complete SVG document for one product, drawn from its record: the colour family tints the body,
 * the material family sets the frame and the surface texture, and the real width:height stretches the
 * silhouette. Pure and deterministic apart from gradient ids, so it can be tested without rendering.
 */
export function productArtSvg(product: ArtProduct): string {
  const base = bodyTone(product);
  const frame = frameTone(product);
  const draw = MAP[product.type] ?? ((_p: ArtProduct, c: string, f: string) => d('cabinet', c, f, {}));
  const id = `g${nextId()}`;
  let body = draw(product, base, frame);
  // Texture every surface fill that is a shade of the body colour (cushions, seats, doors), each as its own
  // pattern so lighter and darker parts keep their light — but never the frame, hardware or props.
  const shades = [...new Set([...body.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1] as string))]
    .filter((hex) => hex.toLowerCase() !== frame.toLowerCase() && near(hex, base));
  let tex = '';
  shades.forEach((hex, i) => {
    const tid = `tx${id}_${i}`;
    const def = texture(product.material, hex, tid);
    if (!def) return;
    tex += def;
    body = body.split(`fill="${hex}"`).join(`fill="url(#${tid})"`);
  });
  const sx = proportion(product);
  const [cx, cy, rx, ry] = SHADOW[product.type] ?? [100, 126, 68, 7];
  const label = `${product.name ?? product.type}, ${product.primaryColour} ${product.material}`;
  return `<svg viewBox="0 0 200 150" preserveAspectRatio="xMidYMid meet">
  <defs><radialGradient id="sh${id}"><stop offset="0" stop-color="${art.ground}" stop-opacity=".22"/><stop offset="1" stop-color="${art.ground}" stop-opacity="0"/></radialGradient>${tex}</defs>
  ${rx ? `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#sh${id})"/>` : ''}
  <g data-label="${label.replace(/"/g, '')}" transform="translate(100 120) scale(${sx.toFixed(3)} ${(1 / sx).toFixed(3)}) translate(-100 -120)">${body}</g></svg>`;
}
