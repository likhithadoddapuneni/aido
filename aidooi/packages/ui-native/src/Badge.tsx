import { View } from 'react-native';
import { Text, type TextTone } from './Text.tsx';
import { useTheme, type Theme } from './theme.tsx';

export type BadgeTone = 'neutral' | 'info' | 'ok' | 'warn' | 'error';

/** Foreground/background per tone. Every pair is asserted ≥ WCAG AA in the tests. */
export function badgeColours(
  color: Theme['color'],
): Record<BadgeTone, { fg: string; bg: string; border: string; text: TextTone }> {
  return {
    neutral: { fg: color.navy, bg: color.beige050, border: color.beige300, text: 'navy' },
    info: { fg: color.navy, bg: color.navy050, border: color.navy200, text: 'navy' },
    ok: { fg: color.ok, bg: color.okBg, border: color.okBorder, text: 'ok' },
    warn: { fg: color.warn, bg: color.warnBg, border: color.warnBorder, text: 'warn' },
    error: { fg: color.err, bg: color.errBg, border: color.errBorder, text: 'error' },
  };
}

/** A read-only status label ("In stock", "Price changed"). */
export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  const { color, space, radius } = useTheme();
  const c = badgeColours(color)[tone];
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: space[2],
        paddingVertical: space[1],
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.bg,
      }}
    >
      <Text variant="caption" tone={c.text} style={{ fontWeight: '600' }}>
        {label}
      </Text>
    </View>
  );
}
