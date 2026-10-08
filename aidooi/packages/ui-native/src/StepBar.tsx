import { View } from 'react-native';
import { Text } from './Text.tsx';
import { useTheme } from './theme.tsx';

/** Segmented progress for a multi-step flow, with an optional "Step 2 of 3" caption. */
export function StepBar({
  step,
  of,
  caption,
}: {
  /** 1-based current step. */
  step: number;
  of: number;
  caption?: string;
}) {
  const { color, space, radius } = useTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={caption ?? `${step}/${of}`}
      accessibilityValue={{ min: 1, max: of, now: step }}
      style={{ gap: space[2] }}
    >
      <View style={{ flexDirection: 'row', gap: space[1] }}>
        {Array.from({ length: of }, (_, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: space[1],
              borderRadius: radius.pill,
              backgroundColor: i < step ? color.navy : color.sand200,
            }}
          />
        ))}
      </View>
      {caption ? (
        <Text variant="caption" tone="secondary">
          {caption}
        </Text>
      ) : null}
    </View>
  );
}
