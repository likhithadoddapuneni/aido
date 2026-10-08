import { art, color, darkenHex as darken, lightenHex as lighten } from '@aidooi/ui-tokens';
import { productArtSvg, type ArtProduct } from './art.ts';

export type RoomKind =
  | 'livingRoom'
  | 'bedroom'
  | 'diningRoom'
  | 'homeOffice'
  | 'studio'
  | 'fullApartment'
  | 'villa'
  | 'individualProduct';

interface Piece {
  readonly type: string;
  readonly colour: string;
  readonly material: string;
  readonly cm: readonly [number, number, number];
  /** Horizontal centre and floor line in the 320×200 scene, and the scale of the 200-wide drawing. */
  readonly cx: number;
  readonly y: number;
  readonly s: number;
}

interface Scene {
  /** Left edge of the window, or null for a room without one. */
  readonly window: number | null;
  readonly pieces: readonly Piece[];
}

const p = (
  type: string,
  colour: string,
  material: string,
  cm: readonly [number, number, number],
  cx: number,
  y: number,
  s: number,
): Piece => ({ type, colour, material, cm, cx, y, s });

/** The furniture each path is introduced with. Illustration only: it never claims to be a product on sale. */
const SCENES: Record<RoomKind, Scene> = {
  livingRoom: {
    window: 214,
    pieces: [
      p('Rug', 'beige', 'Fabric', [240, 160, 2], 140, 192, 1.2),
      p('Wall Art', 'blue', 'Wood', [70, 90, 3], 140, 86, 0.55),
      p('Sofa', 'blue', 'Fabric', [210, 90, 85], 140, 174, 0.95),
      p('Coffee Table', 'natural', 'Wood', [110, 60, 42], 140, 194, 0.62),
      p('Floor Lamp', 'beige', 'Metal', [45, 45, 160], 262, 174, 0.8),
      p('Planter', 'white', 'Ceramic', [35, 35, 50], 36, 174, 0.62),
    ],
  },
  bedroom: {
    window: 22,
    pieces: [
      p('Wall Art', 'beige', 'Wood', [70, 90, 3], 150, 76, 0.5),
      p('Bed', 'grey', 'Fabric', [180, 210, 110], 150, 178, 1.0),
      p('Bedside Table', 'natural', 'Wood', [50, 40, 55], 62, 178, 0.55),
      p('Table Lamp', 'beige', 'Ceramic', [30, 30, 55], 62, 146, 0.45),
      p('Wardrobe', 'white', 'Wood', [150, 60, 210], 268, 178, 0.62),
    ],
  },
  diningRoom: {
    window: null,
    pieces: [
      p('Pendant Light', 'brass', 'Metal', [45, 45, 40], 160, 88, 0.8),
      p('Dining Chair', 'grey', 'Fabric', [45, 50, 90], 84, 168, 0.7),
      p('Dining Chair', 'grey', 'Fabric', [45, 50, 90], 236, 168, 0.7),
      p('Dining Table', 'natural', 'Wood', [180, 90, 76], 160, 180, 0.95),
      p('Dining Chair', 'grey', 'Fabric', [45, 50, 90], 126, 192, 0.8),
      p('Dining Chair', 'grey', 'Fabric', [45, 50, 90], 194, 192, 0.8),
    ],
  },
  homeOffice: {
    window: 240,
    pieces: [
      p('Bookcase', 'natural', 'Wood', [90, 35, 190], 44, 178, 0.98),
      p('Office Chair', 'black', 'Leather', [60, 60, 100], 162, 184, 0.78),
      p('Desk', 'natural', 'Wood', [140, 70, 75], 162, 178, 1.0),
      p('Task Lamp', 'black', 'Metal', [35, 20, 50], 206, 121, 0.5),
      p('Planter', 'white', 'Ceramic', [35, 35, 50], 292, 178, 0.6),
    ],
  },
  studio: {
    window: null,
    pieces: [
      p('Rug', 'grey', 'Fabric', [200, 140, 2], 200, 194, 0.9),
      p('Bed', 'beige', 'Fabric', [160, 200, 100], 74, 178, 0.78),
      p('Sofa', 'green', 'Fabric', [180, 90, 85], 206, 176, 0.75),
      p('Floor Lamp', 'beige', 'Metal', [45, 45, 160], 296, 176, 0.65),
    ],
  },
  fullApartment: {
    window: null,
    pieces: [
      p('Sofa', 'blue', 'Fabric', [200, 90, 85], 62, 176, 0.55),
      p('Floor Lamp', 'brass', 'Metal', [45, 45, 160], 116, 176, 0.6),
      p('Bed', 'grey', 'Fabric', [170, 200, 100], 176, 178, 0.6),
      p('Dining Table', 'natural', 'Wood', [140, 80, 76], 270, 178, 0.5),
    ],
  },
  villa: {
    window: null,
    pieces: [
      p('Chandelier', 'brass', 'Metal', [70, 70, 60], 160, 100, 0.9),
      p('Wall Art', 'beige', 'Wood', [70, 90, 3], 100, 96, 0.5),
      p('Sofa', 'beige', 'Leather', [220, 95, 85], 100, 176, 0.85),
      p('Accent Chair', 'brown', 'Leather', [80, 80, 85], 236, 176, 0.7),
      p('Planter', 'white', 'Ceramic', [35, 35, 50], 296, 176, 0.58),
    ],
  },
  individualProduct: {
    window: null,
    pieces: [
      p('Floor Lamp', 'brass', 'Metal', [45, 45, 160], 62, 176, 0.85),
      p('Accent Chair', 'orange', 'Fabric', [80, 80, 85], 150, 180, 1.2),
      p('Side Table', 'natural', 'Wood', [50, 50, 55], 244, 180, 0.85),
      p('Vase', 'white', 'Ceramic', [25, 25, 40], 244, 126, 0.5),
    ],
  },
};

/** The inside of one drawing — everything between the outer `<svg>` tags. */
const inner = (svg: string): string => svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

/**
 * A calm, front-on room for a path: wall, window light, floor, and the furniture that path is about,
 * drawn with the same illustration system as product images. The viewBox is 320×200.
 */
export function roomSceneSvg(kind: RoomKind): string {
  const scene = SCENES[kind];
  const floor = darken(color.sand200, 0.12);
  const frame = darken(color.sand200, 0.18);
  const body = scene.pieces
    .map((pc) => {
      const prod: ArtProduct = {
        type: pc.type,
        primaryColour: pc.colour,
        material: pc.material,
        widthCm: pc.cm[0],
        depthCm: pc.cm[1],
        heightCm: pc.cm[2],
      };
      // Product drawings are 200 wide with the floor at y=120: put their centre and floor on the scene's.
      return `<g transform="translate(${pc.cx - 100 * pc.s} ${pc.y - 120 * pc.s}) scale(${pc.s})">${inner(productArtSvg(prod))}</g>`;
    })
    .join('');
  const w = scene.window;
  const window =
    w === null
      ? ''
      : `<rect x="${w}" y="22" width="62" height="86" rx="3" fill="${art.glassC}" stroke="${frame}" stroke-width="3"/>
  <path d="M${w + 31} 22v86M${w} 65h62" stroke="${frame}" stroke-width="2"/>
  <path d="M${w} 108l-58 60h92l28-60z" fill="url(#rb)" opacity=".8"/>`;
  return `<svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMax slice">
  <defs>
    <linearGradient id="rb" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${art.white}" stop-opacity="0"/><stop offset=".5" stop-color="${art.glow}" stop-opacity=".5"/><stop offset="1" stop-color="${art.white}" stop-opacity="0"/></linearGradient>
  </defs>
  <rect x="0" y="156" width="320" height="44" fill="${floor}"/>
  <rect x="0" y="152" width="320" height="4" fill="${lighten(floor, 0.35)}"/>
  ${window}
  ${body}
</svg>`;
}
