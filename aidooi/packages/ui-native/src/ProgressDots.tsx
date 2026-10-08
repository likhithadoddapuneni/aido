import { View } from 'react-native';
import { useStrings } from './locale.tsx';
import { useTheme } from './theme.tsx';

/** Wizard progress. Read as one sentence ("Step 2 of 5"), not as five anonymous dots. */
export function ProgressDots({
  total,
  current,
  accessibilityLabel,
}: {
  total: number;
  current: number;
  accessibilityLabel?: string;
}) {
  const { color, space } = useTheme();
  const s = useStrings();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel ?? s('stepOf', { current: current + 1, total })}
      accessibilityValue={{ min: 1, max: total, now: current + 1 }}
      style={{ flexDirection: 'row', gap: space[2] }}
    >
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          testID={`dot-${i}`}
          style={{
            width: space[2],
            height: space[2],
            borderRadius: space[1],
            backgroundColor: i <= current ? color.navy : color.border,
          }}
        />
      ))}
    </View>
  );
}
