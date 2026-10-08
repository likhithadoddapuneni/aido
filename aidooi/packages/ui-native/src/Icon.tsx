import Svg, { Path } from 'react-native-svg';
import { useLocale } from './locale.tsx';
import { useTheme, type Theme } from './theme.tsx';

/**
 * One line-icon family on a 24-unit grid (1.75 stroke, round caps), drawn in code so there is no icon
 * font to load, no web/native mismatch, and every glyph takes its colour from the tokens.
 */
const GLYPHS = {
  home: 'M3.5 11 12 4l8.5 7M5.5 9.8V20h13V9.8M10 20v-5.5h4V20',
  folder: 'M3.5 7.2c0-1 .8-1.7 1.7-1.7h4l2 2.2h7.6c1 0 1.7.8 1.7 1.7v8.1c0 1-.8 1.7-1.7 1.7H5.2c-1 0-1.7-.8-1.7-1.7z',
  bag: 'M5 8.5h14l-1 11H6zM9 8.5V7a3 3 0 0 1 6 0v1.5',
  user: 'M12 12.2a3.8 3.8 0 1 0 0-7.6 3.8 3.8 0 0 0 0 7.6M4.8 20c.6-3.4 3.5-5.2 7.2-5.2s6.6 1.8 7.2 5.2',
  chevron: 'm9.5 5.5 6 6.5-6 6.5',
  back: 'M19 12H5m6-6.5L4.5 12l6.5 6.5',
  forward: 'M5 12h14m-6-6.5 6.5 6.5-6.5 6.5',
  sofa: 'M5 11V8.5A2.5 2.5 0 0 1 7.5 6h9A2.5 2.5 0 0 1 19 8.5V11M3.5 12.5a2 2 0 0 1 4 0V14h9v-1.5a2 2 0 0 1 4 0V17h-17zM6 17v2m12-2v2',
  bed: 'M3.5 18.5V6M3.5 15h17v3.5M20.5 15v-2.5A2.5 2.5 0 0 0 18 10h-7v5M7.5 12.2a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4',
  desk: 'M3.5 8.5h17M5 8.5V19m14-10.5V19M10 8.5v5h9M7 13.5h.01',
  dining: 'M4 9h16M6.5 9v10m11-10v10M9 9l-.7-4h7.4L15 9',
  sparkle: 'M12 3.5c.5 4.2 2.3 6 6.5 6.5-4.2.5-6 2.3-6.5 6.5-.5-4.2-2.3-6-6.5-6.5 4.2-.5 6-2.3 6.5-6.5M18.5 15.5c.2 1.7.9 2.4 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.1 2.3-.8 2.5-2.5',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  calendar: 'M4.5 7.5c0-1 .8-1.8 1.8-1.8h11.4c1 0 1.8.8 1.8 1.8V18c0 1-.8 1.8-1.8 1.8H6.3c-1 0-1.8-.8-1.8-1.8zM4.5 10.5h15M8.5 4v3M15.5 4v3',
  pin: 'M12 20.5s6.5-5.4 6.5-10.4a6.5 6.5 0 1 0-13 0c0 5 6.5 10.4 6.5 10.4M12 12.4a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6',
  clock: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17M12 7.5V12l3 2',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.5v2.5H14zM19 14h1v1M14 19h1m3-1.5h2V20h-3',
  truck: 'M2.8 6.5h11v10h-11zM13.8 10h4l2.7 3v3.5h-6.7M7 19.2a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6M17 19.2a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6',
  shield: 'M12 3.5 5 6v5.5c0 4.2 2.9 7.4 7 9 4.1-1.6 7-4.8 7-9V6z M9 12l2.2 2.2L15.5 10',
  globe: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5S9.6 5.9 12 3.5',
  bell: 'M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5zM10 20.2a2.2 2.2 0 0 0 4 0',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'm6 6 12 12M18 6 6 18',
  swap: 'M5 8.5h13l-3-3M19 15.5H6l3 3',
  lamp: 'M8 4.5h8l2.5 8h-13zM12 12.5V19m-3.5 0h7',
  ruler: 'M3.5 15.5 15.5 3.5l5 5-12 12zM7.5 12.5l2 2M10.5 9.5l2 2M13.5 6.5l2 2',
  wallet: 'M4.5 7.5c0-1 .8-1.8 1.8-1.8h11.2v3M4.5 7.5v10c0 1 .8 1.8 1.8 1.8h12.2c.8 0 1.5-.7 1.5-1.5V9.5c0-.8-.7-1.5-1.5-1.5H6.3c-1 0-1.8-.5-1.8-.5M16 14h.01',
  lock: 'M6 11h12v8.5H6zM8.5 11V8.2a3.5 3.5 0 0 1 7 0V11',
  info: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17M12 11v5.5M12 7.8h.01',
  search: 'M10.8 17.3a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13M20 20l-4.6-4.6',
  warning: 'M12 4 3 19.5h18zM12 10v4.5M12 17.2h.01',
  box: 'M3.8 7.8 12 3.5l8.2 4.3v8.4L12 20.5l-8.2-4.3zM3.8 7.8 12 12l8.2-4.2M12 12v8.5',
  receipt: 'M6 3.5h12v17l-2.4-1.6L13.2 20.5 12 19.4l-1.2 1.1-2.4-1.6L6 20.5zM9 8.5h6M9 12h6',
  logout: 'M14 4.5h4.2c.9 0 1.3.5 1.3 1.3v12.4c0 .8-.4 1.3-1.3 1.3H14M10 8l-4 4 4 4M6 12h9',
  star: 'm12 4 2.4 5 5.4.7-4 3.7 1 5.4-4.8-2.7-4.8 2.7 1-5.4-4-3.7 5.4-.7z',
} as const;

export type IconName = keyof typeof GLYPHS;
export const ICON_NAMES = Object.keys(GLYPHS) as IconName[];

/** Glyphs that point somewhere and so mirror in right-to-left layouts. */
const DIRECTIONAL: ReadonlySet<IconName> = new Set<IconName>(['chevron', 'back', 'forward', 'logout']);

export type IconTone = 'navy' | 'text' | 'secondary' | 'inverse' | 'beige' | 'ok' | 'warn' | 'error';

const toneColour = (c: Theme['color'], tone: IconTone): string =>
  ({
    navy: c.navy,
    text: c.text,
    secondary: c.text2,
    inverse: c.white,
    beige: c.beige,
    ok: c.ok,
    warn: c.warn,
    error: c.err,
  })[tone];

export interface IconProps {
  name: IconName;
  size?: number;
  tone?: IconTone;
}

/** Decorative by default: the control or text next to it carries the meaning. */
export function Icon({ name, size = 24, tone = 'navy' }: IconProps) {
  const { color } = useTheme();
  const { rtl } = useLocale();
  const flip = rtl && DIRECTIONAL.has(name);
  return (
    <Svg
      testID={`icon-${name}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={flip ? { transform: [{ scaleX: -1 }] } : undefined}
    >
      <Path
        d={GLYPHS[name]}
        fill="none"
        stroke={toneColour(color, tone)}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
