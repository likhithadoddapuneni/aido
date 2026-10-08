/**
 * AID-DATA-015 — the AIDOOi design system as data. One source for every client: React Native reads
 * these values directly; web gets the same values as CSS variables (`tokens.css`, generated).
 *
 * Direction from the standard: *warm, premium, calm, intelligent and interior-led.* The standard
 * defines one light identity, so there is deliberately no dark theme to drift out of sync.
 */

export const color = {
  /** Primary buttons, key headings, active states, navigation emphasis. */
  navy: '#12345B',
  navy800: '#0E2A4A',
  navy600: '#244D7C',
  navy200: '#B9C6D6',
  navy050: '#EFF3F8',
  /** Restrained warm accent. Never the dominant action colour, never body text. */
  beige: '#B7A78F',
  beige300: '#D9CFBE',
  beige050: '#F6F1E9',
  /** Primary page background. */
  ivory: '#FAF8F5',
  /** Cards and soft panels. */
  surface: '#F0ECE7',
  surface2: '#F7F4EF',
  text: '#1F2937',
  text2: '#6B7280',
  /**
   * Secondary text on `surface` cards. The standard's `text2` is 4.11:1 there, under WCAG AA (4.5), so
   * captions and metadata inside cards use this slightly darker grey (4.57:1). A documented extension
   * of AID-DATA-015, not a replacement: `text2` is unchanged on ivory and white.
   */
  text2OnSurface: '#636B78',
  /** Placeholder and disabled only — it does not meet contrast for content. */
  text3: '#9AA0A6',
  border: '#E5E1DB',
  borderSoft: '#EFEBE4',
  white: '#FFFFFF',
  ok: '#2F6B4F',
  okBg: '#F1F8F4',
  okBorder: '#CCE2D5',
  warn: '#8A6A2F',
  warnBg: '#FBF6EA',
  warnBorder: '#EADFC4',
  err: '#8C3A3A',
  errBg: '#FBF2F2',
  errBorder: '#E8CFCF',
  /**
   * Warm atmosphere for hero areas and illustration backdrops: calm tints of the identity colours, never
   * used for text. `ink` is the deepest navy, for the one dark moment per screen.
   */
  sand: '#EFE7DA',
  sand200: '#E4D9C6',
  linen: '#F5F0E8',
  ink: '#0B2240',
  /** Veil behind sheets and over imagery. */
  scrim: 'rgba(11,34,64,0.45)',
  /** Frosted bars that float over content. */
  glass: 'rgba(250,248,245,0.92)',
  /** White text on a photographic or gradient surface needs this shade, not `beige`. */
  onInkMuted: '#C9D3E0',
} as const;

/** Two-stop gradients, top to bottom; the same stops are used by every client. */
export const gradient = {
  hero: ['#F5F0E8', '#EFE7DA'],
  navy: ['#1B4474', '#0E2A4A'],
  dawn: ['#FAF8F5', '#F0E9DC'],
  room: ['#F7F2EA', '#E9DFCD'],
} as const;

/**
 * Native elevation, the counterpart of the CSS `shadow` strings (React Native cannot parse those).
 * Navy-tinted and soft: depth should read as light, not as a border.
 */
export const elevation = {
  none: { shadowColor: '#12345B', shadowOpacity: 0, shadowRadius: 0, shadowOffsetY: 0, android: 0 },
  sm: { shadowColor: '#12345B', shadowOpacity: 0.07, shadowRadius: 8, shadowOffsetY: 2, android: 2 },
  md: { shadowColor: '#12345B', shadowOpacity: 0.1, shadowRadius: 20, shadowOffsetY: 8, android: 5 },
  lg: { shadowColor: '#12345B', shadowOpacity: 0.16, shadowRadius: 36, shadowOffsetY: 16, android: 10 },
} as const;

/** The standard's spacing scale, in px. */
export const space = { 1: 4, 2: 8, 3: 16, 4: 24, 5: 32, 6: 48, 7: 64, 8: 96 } as const;

export const radius = { sm: 8, md: 12, lg: 18, xl: 26, pill: 999 } as const;

export const shadow = {
  xs: '0 1px 2px rgba(18,52,91,.05)',
  sm: '0 2px 8px rgba(18,52,91,.06)',
  md: '0 8px 28px rgba(18,52,91,.08)',
  lg: '0 20px 60px rgba(18,52,91,.13)',
} as const;

/**
 * Editorial serif for display headings, a clean sans for everything functional. Decorative type must
 * never reduce the readability of prices, dimensions or availability, so those always use `sans`.
 * Arabic has its own pairing so the two scripts keep the same weight and rhythm.
 */
export const font = {
  serif: '"Cormorant Garamond", "Playfair Display", Georgia, serif',
  sans: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  arabicSans: '"IBM Plex Sans Arabic", "Noto Sans Arabic", Tahoma, sans-serif',
  arabicDisplay: '"IBM Plex Sans Arabic", "Noto Sans Arabic", Tahoma, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

export const fontSize = {
  caption: 12,
  small: 14,
  body: 16,
  lead: 18,
  h3: 20,
  title: 24,
  h2: 28,
  h1: 40,
  hero: 48,
} as const;
export const lineHeight = { tight: 1.15, snug: 1.35, body: 1.6 } as const;

/** Standard breakpoints. Responsive behaviour preserves content priority; it does not shrink the desktop page. */
export const breakpoint = { mobile: 320, tablet: 768, laptop: 1024, desktop: 1280 } as const;

/** Minimum touch target on mobile (WCAG 2.2 AA says 24; platform guidance says 44 — we follow the stricter). */
export const touchTarget = 44;

export const motion = {
  fast: 120,
  base: 200,
  slow: 320,
  easing: 'cubic-bezier(.22,.61,.36,1)',
} as const;


/**
 * Product illustration palette. Products are drawn from their own records (AID-DATA-012): the colour
 * family tints the body and the material family picks the frame, so a drawing never shows what the
 * record does not say. These are illustration colours, not UI colours — never use them for text.
 */
export const art = {
  tone: {
    white: '#EFEBE3', beige: '#D8C5A6', grey: '#9BA1A7', black: '#36393D', brown: '#8A5B38',
    natural: '#C6A676', green: '#6E8168', blue: '#3C5B7B', red: '#8B3B3B', orange: '#B4673C',
    yellow: '#C7A32C', pink: '#D3A5A0', purple: '#79648E', gold: '#BE9F60', silver: '#B4B8BC',
    brass: '#AE8C3F', bronze: '#886944', multicolour: '#B6A694',
  },
  fallbackTone: '#BFB5A6',
  frame: {
    Wood: '#96663C', Rattan: '#BC9A62', Fabric: '#8C6239', Leather: '#6F4B2E', Metal: '#6F767D',
    Glass: '#8FA4B0', Stone: '#9E978C', Ceramic: '#A79F93',
  },
  fallbackFrame: '#8C6239',
  ground: '#12345B',
  sheet: '#F3EFE8', pillow: '#FBF8F3', pillowEdge: '#E3DCD1', canvas: '#FBF9F5', white: '#FFFFFF',
  glow: '#F6E7C4', bookA: '#7D8FA3', bookB: '#B7A78F', bookC: '#9BA98F', bookD: '#A3836B',
  leaf: '#7F9472', leafDark: '#6E8168', leafLight: '#8EA081', leafDeep: '#6B7F63',
  screen: '#2A3138', screenLight: '#39434C',
  glassA: '#F3F6F8', glassB: '#DCE5EA', glassC: '#F7FAFC', glassD: '#D4DDE3',
  deep: '#101417',
} as const;

const hex2rgb = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
const rgb2hex = (a: readonly number[]): string =>
  '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** Blend two 6-digit hex colours; `t` is how far towards `b`, 0–1. */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hex2rgb(a);
  const [br, bg, bb] = hex2rgb(b);
  return rgb2hex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}
export const lightenHex = (c: string, t: number): string => mixHex(c, '#FFFFFF', t);
export const darkenHex = (c: string, t: number): string => mixHex(c, art.deep, t);

export const tokens = {
  color,
  space,
  radius,
  shadow,
  elevation,
  gradient,
  art,
  font,
  fontSize,
  lineHeight,
  breakpoint,
  touchTarget,
  motion,
} as const;

/* ---------- Accessibility maths ---------- */

const channel = (v: number): number => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Not a 6-digit hex colour: ${hex}`);
  const n = parseInt(m[1] as string, 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

/** WCAG 2.x contrast ratio between two colours, 1–21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Foreground/background pairs the design uses for content, with the WCAG AA level each must meet. */
export const CONTENT_PAIRS: readonly { name: string; fg: string; bg: string; min: number }[] = [
  { name: 'body text on ivory', fg: color.text, bg: color.ivory, min: 4.5 },
  { name: 'body text on surface', fg: color.text, bg: color.surface, min: 4.5 },
  { name: 'body text on white', fg: color.text, bg: color.white, min: 4.5 },
  { name: 'secondary text on ivory', fg: color.text2, bg: color.ivory, min: 4.5 },
  { name: 'secondary text on white', fg: color.text2, bg: color.white, min: 4.5 },
  {
    name: 'secondary text on surface (extended token)',
    fg: color.text2OnSurface,
    bg: color.surface,
    min: 4.5,
  },
  { name: 'secondary text on surface-2', fg: color.text2OnSurface, bg: color.surface2, min: 4.5 },
  { name: 'navy heading on ivory', fg: color.navy, bg: color.ivory, min: 4.5 },
  { name: 'white on navy (primary button)', fg: color.white, bg: color.navy, min: 4.5 },
  { name: 'white on navy-800 (pressed button)', fg: color.white, bg: color.navy800, min: 4.5 },
  { name: 'navy on sand (hero backdrop)', fg: color.navy, bg: color.sand, min: 4.5 },
  { name: 'text on linen', fg: color.text, bg: color.linen, min: 4.5 },
  { name: 'white on ink', fg: color.white, bg: color.ink, min: 4.5 },
  { name: 'muted text on ink', fg: color.onInkMuted, bg: color.ink, min: 4.5 },
  { name: 'muted text on navy-800', fg: color.onInkMuted, bg: color.navy800, min: 4.5 },
  { name: 'secondary text on linen', fg: color.text2OnSurface, bg: color.linen, min: 4.5 },
  { name: 'navy on beige-050 (soft badge)', fg: color.navy, bg: color.beige050, min: 4.5 },
  { name: 'ok text on ok background', fg: color.ok, bg: color.okBg, min: 4.5 },
  { name: 'warn text on warn background', fg: color.warn, bg: color.warnBg, min: 4.5 },
  { name: 'error text on error background', fg: color.err, bg: color.errBg, min: 4.5 },
];
