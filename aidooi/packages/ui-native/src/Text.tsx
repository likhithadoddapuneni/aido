import {
  StyleSheet,
  Text as RNText,
  type TextProps as RNTextProps,
  type TextStyle,
} from 'react-native';
import { fontFamily, snapWeight, type FontRole } from './internal/fonts.ts';
import { useLocale } from './locale.tsx';
import { useTheme } from './theme.tsx';

export type TextVariant = 'hero' | 'display' | 'title' | 'h1' | 'h2' | 'h3' | 'body' | 'caption' | 'label' | 'price';
export type TextTone =
  | 'default'
  | 'secondary'
  | 'inverse'
  | 'inverseMuted'
  | 'navy'
  | 'ok'
  | 'warn'
  | 'error';

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  tone?: TextTone;
  /** The text sits on a `surface` card: secondary text then uses the darker AA-safe grey (ADR-048). */
  onSurface?: boolean;
}

interface Spec {
  readonly size: 'hero' | 'title' | 'h1' | 'h2' | 'h3' | 'lead' | 'body' | 'small' | 'caption';
  readonly weight: TextStyle['fontWeight'];
  readonly role: FontRole;
  readonly header: boolean;
  /** Ceiling for OS font scaling, so large accessibility sizes help without breaking layouts. */
  readonly maxScale: number;
}

/**
 * Editorial serif only for display headings; every functional string — and always every price — is the
 * clean sans (AID-DATA-015): decorative type must never reduce the readability of prices or availability.
 */
const SPEC: Record<TextVariant, Spec> = {
  hero: { size: 'hero', weight: '600', role: 'display', header: true, maxScale: 1.2 },
  title: { size: 'h2', weight: '700', role: 'display', header: true, maxScale: 1.3 },
  display: { size: 'h1', weight: '600', role: 'display', header: true, maxScale: 1.3 },
  h1: { size: 'h2', weight: '600', role: 'display', header: true, maxScale: 1.3 },
  h2: { size: 'h3', weight: '600', role: 'ui', header: true, maxScale: 1.4 },
  h3: { size: 'lead', weight: '600', role: 'ui', header: true, maxScale: 1.4 },
  body: { size: 'body', weight: '400', role: 'ui', header: false, maxScale: 1.8 },
  caption: { size: 'caption', weight: '400', role: 'ui', header: false, maxScale: 1.8 },
  label: { size: 'small', weight: '600', role: 'ui', header: false, maxScale: 1.6 },
  price: { size: 'body', weight: '700', role: 'ui', header: false, maxScale: 1.5 },
};

export function Text({
  variant = 'body',
  tone = 'default',
  onSurface = false,
  style,
  ...rest
}: TextProps) {
  const { color, fontSize, lineHeight } = useTheme();
  const { locale, rtl } = useLocale();
  const spec = SPEC[variant];
  const size = fontSize[spec.size];
  const colours: Record<TextTone, string> = {
    default: color.text,
    secondary: onSurface ? color.text2OnSurface : color.text2,
    inverse: color.white,
    inverseMuted: color.onInkMuted,
    navy: color.navy,
    ok: color.ok,
    warn: color.warn,
    error: color.err,
  };
  // Arabic ascenders and marks need more room than Latin display type's tight leading.
  const leading =
    spec.role === 'display' && !rtl
      ? lineHeight.tight
      : variant === 'body' || variant === 'caption'
        ? lineHeight.body
        : lineHeight.snug;
  // The caller's style may still ask for a weight; the matching face is chosen here, since a custom font
  // family has no synthetic bold that is reliable across platforms.
  const weight = snapWeight(StyleSheet.flatten(style)?.fontWeight ?? spec.weight);
  return (
    <RNText
      accessibilityRole={spec.header ? 'header' : undefined}
      allowFontScaling
      maxFontSizeMultiplier={spec.maxScale}
      style={[
        {
          color: colours[tone],
          fontFamily: fontFamily(spec.role, locale, weight),
          fontSize: size,
          lineHeight: Math.round(size * leading),
          writingDirection: rtl ? 'rtl' : 'ltr',
          textAlign: 'auto',
        },
        variant === 'price' && { fontVariant: ['tabular-nums'] },
        style,
        { fontWeight: 'normal' },
      ]}
      {...rest}
    />
  );
}
