/**
 * Deterministic top-down layout for the concept plan (AID-LOG-011). Pure and unit-tested; the component
 * only draws what this returns.
 *
 * Algorithm
 *  1. Items that carry a position keep it (clamped into the room), in input order, if they still fit and
 *     overlap nothing already placed. Items that conflict, or have no position, are auto-placed.
 *  2. Auto items are sorted largest first (area, then id) and each is put at the first free spot found by
 *     scanning the room row by row in `stepCm` steps. A spot is free when the item stays inside the room,
 *     `clearanceCm` from the walls and from every item already placed.
 *  3. An item that is bigger than the room, or finds no free spot, is reported in `unplaced` — never drawn
 *     overlapping or outside the walls. A plan that cannot show everything must say so.
 *
 *     Before that scan, a piece whose `type` is known tries the places a person would put it: large
 *     pieces against a wall (top, then bottom, then the sides), a coffee or dining table in the middle,
 *     lamps and plants in the corners, a bedside table next to the bed. The scan is the fallback, so the
 *     guarantees above are unchanged: nothing leaves the room or overlaps.
 *
 * Underlays (a rug) sit beneath the furniture: they are centred, never block anything, and are never
 * blocked — a rug under a sofa is the point of a rug.
 *
 * The same input always gives the same output: no randomness, no dependence on object order beyond the
 * documented sort. Dimensions are the verified product dimensions in centimetres.
 */
export interface PlanItem {
  readonly id: string;
  readonly label: string;
  readonly widthCm: number;
  readonly depthCm: number;
  /** Top-left corner in cm from the room's top-left, if the caller wants it fixed. */
  readonly x?: number;
  readonly y?: number;
  /** What the drawing should show. Optional: without them the plan draws a plain labelled box. */
  readonly type?: string;
  readonly colour?: string;
  readonly material?: string;
  /** Lies on the floor under other furniture (a rug): centred, and ignored by collision. */
  readonly underlay?: boolean;
}

export interface PlanInput {
  readonly roomWidthCm: number;
  readonly roomDepthCm: number;
  readonly items: readonly PlanItem[];
  readonly clearanceCm?: number;
  readonly stepCm?: number;
}

export interface PlacedItem {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly widthCm: number;
  readonly depthCm: number;
  readonly type?: string;
  readonly colour?: string;
  readonly material?: string;
  readonly underlay?: boolean;
}

export interface PlanLayout {
  readonly roomWidthCm: number;
  readonly roomDepthCm: number;
  readonly placed: readonly PlacedItem[];
  readonly unplaced: readonly string[];
}

type Box = { x: number; y: number; widthCm: number; depthCm: number };

/** Do two boxes come closer than `gap` cm? (gap 0 = they truly overlap.) */
export const collides = (a: Box, b: Box, gap: number): boolean =>
  a.x < b.x + b.widthCm + gap &&
  b.x < a.x + a.widthCm + gap &&
  a.y < b.y + b.depthCm + gap &&
  b.y < a.y + a.depthCm + gap;

const inside = (b: Box, w: number, d: number): boolean =>
  b.x >= 0 && b.y >= 0 && b.x + b.widthCm <= w && b.y + b.depthCm <= d;

export function layoutPlan(input: PlanInput): PlanLayout {
  const { roomWidthCm: W, roomDepthCm: D } = input;
  const clearance = input.clearanceCm ?? 10;
  const step = Math.max(1, input.stepCm ?? 10);
  const placed = new Map<string, PlacedItem>();
  const unplaced: string[] = [];
  const auto: PlanItem[] = [];
  const layers = new Map<string, PlacedItem>();
  const meta = (it: PlanItem) => ({
    ...(it.type !== undefined ? { type: it.type } : {}),
    ...(it.colour !== undefined ? { colour: it.colour } : {}),
    ...(it.material !== undefined ? { material: it.material } : {}),
    ...(it.underlay ? { underlay: true } : {}),
  });

  const clash = (box: Box, gap: number): boolean =>
    [...placed.values()].some((p) => collides(box, p, gap));

  for (const it of input.items) {
    if (it.widthCm > W || it.depthCm > D) {
      unplaced.push(it.id);
      continue;
    }
    if (it.underlay) {
      layers.set(it.id, {
        id: it.id,
        label: it.label,
        x: Math.round((W - it.widthCm) / 2),
        y: Math.round((D - it.depthCm) / 2),
        widthCm: it.widthCm,
        depthCm: it.depthCm,
        ...meta(it),
      });
      continue;
    }
    if (it.x === undefined || it.y === undefined) {
      auto.push(it);
      continue;
    }
    const x = Math.min(Math.max(0, it.x), W - it.widthCm);
    const y = Math.min(Math.max(0, it.y), D - it.depthCm);
    const box = { x, y, widthCm: it.widthCm, depthCm: it.depthCm };
    if (clash(box, 0)) auto.push(it);
    else placed.set(it.id, { id: it.id, label: it.label, ...box, ...meta(it) });
  }

  const bySize = [...auto].sort(
    (a, b) =>
      b.widthCm * b.depthCm - a.widthCm * a.depthCm || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  for (const it of bySize) {
    const spot =
      preferredSpot(it, W, D, clearance, clash, placed) ?? findSpot(it, W, D, clearance, step, clash);
    if (spot) placed.set(it.id, { id: it.id, label: it.label, ...spot, ...meta(it) });
    else unplaced.push(it.id);
  }

  return {
    roomWidthCm: W,
    roomDepthCm: D,
    placed: input.items.flatMap((it) => {
      const hit = placed.get(it.id) ?? layers.get(it.id);
      return hit ? [hit] : [];
    }),
    unplaced,
  };
}

function findSpot(
  it: PlanItem,
  W: number,
  D: number,
  clearance: number,
  step: number,
  clash: (b: Box, gap: number) => boolean,
): Box | null {
  // Prefer keeping clear of the walls; an item that only fits against them is still better shown than dropped.
  for (const edge of [clearance, 0]) {
    for (let y = edge; y + it.depthCm <= D - edge; y += step) {
      for (let x = edge; x + it.widthCm <= W - edge; x += step) {
        const box = { x, y, widthCm: it.widthCm, depthCm: it.depthCm };
        if (inside(box, W, D) && !clash(box, edge === 0 ? 0 : clearance)) return box;
      }
    }
  }
  return null;
}

type Placement = 'wall' | 'centre' | 'corner' | 'beside' | 'other';

const PLACEMENT: Readonly<Record<string, Placement>> = {
  Sofa: 'wall',
  Bed: 'wall',
  'TV Unit': 'wall',
  Wardrobe: 'wall',
  Bookcase: 'wall',
  Sideboard: 'wall',
  'Chest of Drawers': 'wall',
  'Storage Cabinet': 'wall',
  'Console Table': 'wall',
  Desk: 'wall',
  Bench: 'wall',
  'Coffee Table': 'centre',
  'Dining Table': 'centre',
  'Floor Lamp': 'corner',
  Planter: 'corner',
  'Side Table': 'corner',
  'Task Lamp': 'corner',
  'Table Lamp': 'corner',
  Vase: 'corner',
  'Decorative Object': 'corner',
  'Bedside Table': 'beside',
};

/** Where a person would put this piece, in order of preference; the first free place wins. */
function preferredSpot(
  it: PlanItem,
  W: number,
  D: number,
  edge: number,
  clash: (b: Box, gap: number) => boolean,
  placed: ReadonlyMap<string, PlacedItem>,
): Box | null {
  const kind = (it.type && PLACEMENT[it.type]) || 'other';
  if (kind === 'other') return null;
  const w = it.widthCm;
  const d = it.depthCm;
  const cx = Math.round((W - w) / 2);
  const cy = Math.round((D - d) / 2);
  const right = W - w - edge;
  const bottom = D - d - edge;
  let spots: readonly (readonly [number, number])[] = [];
  if (kind === 'wall') {
    spots = [[cx, edge], [cx, bottom], [edge, cy], [right, cy], [edge, edge], [right, edge]];
  } else if (kind === 'centre') {
    spots = [[cx, cy]];
  } else if (kind === 'corner') {
    spots = [[edge, edge], [right, edge], [edge, bottom], [right, bottom]];
  } else {
    const bed = [...placed.values()].find((p) => p.type === 'Bed');
    if (bed) spots = [[bed.x - w - edge / 2, bed.y], [bed.x + bed.widthCm + edge / 2, bed.y]];
  }
  const GAP = 5;
  for (const [x, y] of spots) {
    const box = { x: Math.round(x), y: Math.round(y), widthCm: w, depthCm: d };
    if (inside(box, W, D) && !clash(box, kind === 'beside' ? 0 : GAP)) return box;
  }
  return null;
}
