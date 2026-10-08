import { art, color, darkenHex as darken, lightenHex as lighten, mixHex as mix } from '@aidooi/ui-tokens';
import { bodyTone } from './art.ts';
import type { PlacedItem } from './planLayout.ts';

/**
 * Top-down glyphs for the concept plan, drawn from the same record fields as the product illustrations:
 * the colour family tints each piece, and the type decides its shape. Coordinates are in pixels.
 */
type Glyph = (x: number, y: number, w: number, h: number, c: string) => string;

const sofa: Glyph = (x, y, w, h, c) => {
  const seats = Math.max(2, Math.round(w / 38));
  const inner = (w - h * 0.28) / seats;
  let cu = '';
  for (let i = 0; i < seats; i++)
    cu += `<rect x="${x + h * 0.14 + i * inner + 1}" y="${y + h * 0.36}" width="${inner - 2}" height="${h * 0.56}" rx="${h * 0.1}" fill="${lighten(c, 0.14)}" stroke="${darken(c, 0.14)}" stroke-width=".8"/>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h * 0.16}" fill="${c}" stroke="${darken(c, 0.2)}" stroke-width="1"/>
  <rect x="${x + h * 0.14}" y="${y + h * 0.08}" width="${w - h * 0.28}" height="${h * 0.26}" rx="${h * 0.1}" fill="${darken(c, 0.08)}"/>${cu}`;
};
const bed: Glyph = (x, y, w, h, c) => `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h * 0.04}" fill="${mix(c, art.sheet, 0.55)}" stroke="${darken(c, 0.2)}" stroke-width="1"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h * 0.13}" rx="${h * 0.03}" fill="${c}"/>
  <rect x="${x + w * 0.08}" y="${y + h * 0.16}" width="${w * 0.38}" height="${h * 0.17}" rx="${h * 0.04}" fill="${art.white}" stroke="${art.pillowEdge}"/>
  <rect x="${x + w * 0.54}" y="${y + h * 0.16}" width="${w * 0.38}" height="${h * 0.17}" rx="${h * 0.04}" fill="${art.white}" stroke="${art.pillowEdge}"/>
  <path d="M${x} ${y + h * 0.55}h${w}" stroke="${darken(c, 0.12)}" stroke-width="1.2"/>`;
const table: Glyph = (x, y, w, h, c) => `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(w, h) * 0.08}" fill="${c}" stroke="${darken(c, 0.22)}" stroke-width="1"/>
  <rect x="${x + 4}" y="${y + 4}" width="${Math.max(0, w - 8)}" height="${Math.max(0, h - 8)}" rx="2" fill="none" stroke="${lighten(c, 0.22)}" stroke-width="1"/>`;
const chair: Glyph = (x, y, w, h, c) => `
  <rect x="${x}" y="${y + h * 0.22}" width="${w}" height="${h * 0.78}" rx="${w * 0.14}" fill="${lighten(c, 0.1)}" stroke="${darken(c, 0.2)}" stroke-width=".8"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h * 0.22}" rx="2" fill="${c}"/>`;
const storage =
  (n: number): Glyph =>
  (x, y, w, h, c) => {
    let d = '';
    for (let i = 1; i < n; i++)
      d += `<path d="M${x + (w / n) * i} ${y}v${h}" stroke="${darken(c, 0.18)}" stroke-width="1"/>`;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${c}" stroke="${darken(c, 0.22)}" stroke-width="1"/>${d}
    <path d="M${x} ${y + h}h${w}" stroke="${darken(c, 0.25)}" stroke-width="1.6"/>`;
  };
const rug: Glyph = (x, y, w, h, c) => `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${c}" opacity=".5"/>
  <rect x="${x + 6}" y="${y + 6}" width="${Math.max(0, w - 12)}" height="${Math.max(0, h - 12)}" rx="2" fill="none" stroke="${lighten(c, 0.3)}" stroke-width="2"/>`;
const lamp: Glyph = (x, y, w, h, c) => `
  <circle cx="${x + w / 2}" cy="${y + h / 2}" r="${w / 2 + 8}" fill="${art.glow}" opacity=".45"/>
  <circle cx="${x + w / 2}" cy="${y + h / 2}" r="${w / 2}" fill="${c}" stroke="${darken(c, 0.2)}" stroke-width="1"/>`;
const plant: Glyph = (x, y, w, h, c) => `
  <circle cx="${x + w / 2}" cy="${y + h / 2}" r="${w / 2}" fill="${art.leaf}" opacity=".7"/>
  <circle cx="${x + w / 2}" cy="${y + h / 2}" r="${w / 3.4}" fill="${c}"/>`;
const wall: Glyph = (x, y, w, _h, c) =>
  `<rect x="${x}" y="${y}" width="${w}" height="6" rx="2" fill="${c}" stroke="${darken(c, 0.2)}" stroke-width=".8"/>`;

const GLYPH: Record<string, Glyph> = {
  Sofa: sofa,
  Bed: bed,
  Rug: rug,
  'Dining Table': table,
  'Coffee Table': table,
  'Side Table': table,
  'Console Table': table,
  Desk: table,
  'Dining Chair': chair,
  'Accent Chair': chair,
  'Office Chair': chair,
  Bench: chair,
  'Floor Lamp': lamp,
  'Table Lamp': lamp,
  'Task Lamp': lamp,
  'Pendant Light': lamp,
  Chandelier: lamp,
  Planter: plant,
  Vase: plant,
  'Decorative Object': plant,
  'Wall Art': wall,
  Mirror: wall,
  'Wall Light': wall,
  Wardrobe: storage(3),
  'Chest of Drawers': storage(3),
  'TV Unit': storage(3),
  Sideboard: storage(2),
  Bookcase: storage(4),
  'Bedside Table': storage(1),
  'Storage Cabinet': storage(2),
};

/** The glyph for one placed piece, or a plain tinted box when the type is unknown or not given. */
export function planGlyph(p: PlacedItem, scale: number): string {
  const c = bodyTone({ primaryColour: p.colour ?? '' });
  const draw = (p.type ? GLYPH[p.type] : undefined) ?? storage(1);
  return draw(p.x * scale, p.y * scale, p.widthCm * scale, p.depthCm * scale, c);
}

/**
 * The room as one SVG document: boarded floor, soft grid, thick walls, rugs first then furniture, and a
 * ring around the selected piece. Pure so it can be tested without rendering.
 */
export function planSvg(input: {
  px: number;
  height: number;
  scale: number;
  roomWidthCm: number;
  roomDepthCm: number;
  placed: readonly PlacedItem[];
  selectedId: string | null;
}): string {
  const { px, height, scale, placed, selectedId } = input;
  const board = Math.max(10, 22 * scale * 5);
  const boards: string[] = [];
  for (let y = board; y < height; y += board)
    boards.push(`<path d="M0 ${y.toFixed(1)}H${px}" stroke="${darken(color.sand200, 0.06)}" stroke-width=".7" opacity=".55"/>`);
  const grid: string[] = [];
  for (let m = 1; m * 100 * scale < px; m++)
    grid.push(`<path d="M${(m * 100 * scale).toFixed(1)} 0V${height}" stroke="${color.white}" stroke-width=".8" opacity=".35"/>`);
  for (let m = 1; m * 100 * scale < height; m++)
    grid.push(`<path d="M0 ${(m * 100 * scale).toFixed(1)}H${px}" stroke="${color.white}" stroke-width=".8" opacity=".35"/>`);
  const order = [...placed].sort((a, b) => Number(b.underlay === true) - Number(a.underlay === true));
  const pieces = order.map((p) => planGlyph(p, scale)).join('');
  const sel = placed.find((p) => p.id === selectedId);
  const ring = sel
    ? `<rect x="${sel.x * scale - 3}" y="${sel.y * scale - 3}" width="${sel.widthCm * scale + 6}" height="${sel.depthCm * scale + 6}" rx="6" fill="none" stroke="${color.navy}" stroke-width="2.5"/>`
    : '';
  return `<svg viewBox="0 0 ${px} ${height}">
  <rect width="${px}" height="${height}" fill="${color.sand}"/>${boards.join('')}${grid.join('')}
  ${pieces}${ring}
  <rect x="1.5" y="1.5" width="${px - 3}" height="${height - 3}" rx="8" fill="none" stroke="${color.navy}" stroke-width="3"/>
</svg>`;
}
