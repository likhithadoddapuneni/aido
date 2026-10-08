import { Platform } from 'react-native';
import { font } from '@aidooi/ui-tokens';
import type { Locale } from '@aidooi/i18n';

export type FontRole = 'display' | 'ui';
export type FontWeight = '400' | '500' | '600' | '700';

/**
 * Native text engines pick a face by family name, and a custom family has exactly the faces registered
 * for it, so weight is part of the name (`Inter_600SemiBold`). The app registers these names with
 * `expo-font`; until they are loaded the system font is used. On web the same face is named first and the
 * token stack follows as the fallback.
 */
const FACES = {
  serif: {
    '400': 'CormorantGaramond_500Medium',
    '500': 'CormorantGaramond_500Medium',
    '600': 'CormorantGaramond_600SemiBold',
    '700': 'CormorantGaramond_700Bold',
  },
  sans: {
    '400': 'Inter_400Regular',
    '500': 'Inter_500Medium',
    '600': 'Inter_600SemiBold',
    '700': 'Inter_700Bold',
  },
  arabic: {
    '400': 'IBMPlexSansArabic_400Regular',
    '500': 'IBMPlexSansArabic_500Medium',
    '600': 'IBMPlexSansArabic_600SemiBold',
    '700': 'IBMPlexSansArabic_700Bold',
  },
} as const;

/** Every face the app must load, by registered name. The app imports the matching font files. */
export const FACE_NAMES: readonly string[] = [
  ...Object.values(FACES.serif),
  ...Object.values(FACES.sans),
  ...Object.values(FACES.arabic),
].filter((n, i, all) => all.indexOf(n) === i);

/** Normalise any RN fontWeight to the four weights that have a face. */
export function snapWeight(w: unknown): FontWeight {
  const n = w === 'bold' ? 700 : w === 'normal' || w === undefined ? 400 : Number(w);
  if (!Number.isFinite(n)) return '400';
  if (n >= 700) return '700';
  if (n >= 600) return '600';
  if (n >= 500) return '500';
  return '400';
}

/** Display type is serif in Latin; everything functional — including every price — is sans. */
export function fontFamily(role: FontRole, locale: Locale, weight: FontWeight = '400'): string {
  const set = locale === 'ar' ? FACES.arabic : role === 'display' ? FACES.serif : FACES.sans;
  const face = set[weight];
  if (Platform.OS !== 'web') return face;
  const stack =
    locale === 'ar' ? font.arabicSans : role === 'display' ? font.serif : font.sans;
  return `${face}, ${stack}`;
}

/** The first family of a token stack — kept for callers that name a system font directly. */
export const nativeFamily = (stack: string): string => {
  const first = stack.split(',')[0] ?? stack;
  return first.trim().replace(/^["']|["']$/g, '');
};
