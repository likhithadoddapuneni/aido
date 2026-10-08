import { View, type StyleProp, type ViewStyle } from 'react-native';
import { formatMoney, type Locale } from '@aidooi/i18n';
import { useLocale, useStrings } from './locale.tsx';
import { Text } from './Text.tsx';
import { useTheme } from './theme.tsx';

export interface MoneyProps {
  /** Integer fils (1 AED = 100 fils): the only money representation in the system. */
  fils: number;
  /** Override the app locale, e.g. to show an English price inside an Arabic screen. */
  locale?: Locale;
  /** The seller's original price, shown struck through beside the current price. Never used to rank. */
  originalFils?: number | null;
  tone?: 'default' | 'secondary' | 'navy' | 'inverse';
  /** A headline amount (room total, order total): the same sans and tabular figures, larger. */
  large?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Money({ fils, locale, originalFils = null, tone = 'default', large = false, style }: MoneyProps) {
  const app = useLocale().locale;
  const s = useStrings();
  const { space, fontSize, lineHeight } = useTheme();
  const l = locale ?? app;
  if (!Number.isInteger(fils)) throw new RangeError('Money takes integer fils, never a float');
  const current = formatMoney(fils, l);
  const was = originalFils !== null && originalFils > fils ? formatMoney(originalFils, l) : null;
  return (
    <View
      accessible
      accessibilityLabel={was ? `${current}, ${s('wasPrice', { price: was })}` : current}
      style={[{ flexDirection: 'row', alignItems: 'baseline', gap: space[2] }, style]}
    >
      <Text
        variant="price"
        tone={tone}
        style={large ? { fontSize: fontSize.title, lineHeight: Math.round(fontSize.title * lineHeight.snug) } : undefined}
      >
        {current}
      </Text>
      {was ? (
        <Text
          variant="caption"
          tone="secondary"
          style={{ textDecorationLine: 'line-through', fontVariant: ['tabular-nums'] }}
        >
          {was}
        </Text>
      ) : null}
    </View>
  );
}
