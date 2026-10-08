import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Text } from './Text.tsx';
import { useTheme } from './theme.tsx';

export interface ScoreRingProps {
  /** 0–100, exactly as the server scored it. The ring only draws it. */
  score: number;
  size?: number;
  /** `inverse` for use on the dark ink surface. */
  tone?: 'default' | 'inverse';
  accessibilityLabel?: string;
}

/** A ring that shows the server's match score; the number inside is the same figure, in text. */
export function ScoreRing({ score, size = 56, tone = 'default', accessibilityLabel }: ScoreRingProps) {
  const { color } = useTheme();
  const clamped = Math.max(0, Math.min(100, score));
  const stroke = Math.max(3, Math.round(size / 12));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel ?? String(clamped)}
      accessibilityValue={{ min: 0, max: 100, now: clamped }}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={tone === 'inverse' ? color.navy600 : color.sand200} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={tone === 'inverse' ? color.white : color.navy}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${(c * clamped) / 100} ${c}`}
        />
      </Svg>
      <Text variant="label" tone={tone === 'inverse' ? 'inverse' : 'navy'} style={{ fontVariant: ['tabular-nums'] }}>
        {clamped}
      </Text>
    </View>
  );
}
