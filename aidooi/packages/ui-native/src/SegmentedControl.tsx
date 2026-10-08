import { Pressable, View } from 'react-native';
import { Text } from './Text.tsx';
import { useTheme } from './theme.tsx';

export interface SegmentedControlProps<V extends string> {
  options: readonly { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
  accessibilityLabel?: string;
}

/** Mutually exclusive choice (a bed size, a tier). Segments read as radios; order follows the reading direction. */
export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: SegmentedControlProps<V>) {
  const { color, space, radius, touchTarget } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={{
        flexDirection: 'row',
        borderRadius: radius.pill,
        padding: space[1],
        gap: space[1],
        backgroundColor: color.sand,
      }}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ checked: selected }}
            onPress={() => !selected && onChange(o.value)}
            style={{
              flex: 1,
              minHeight: touchTarget,
              paddingHorizontal: space[2],
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.pill,
              backgroundColor: selected ? color.navy : 'transparent',
            }}
          >
            <Text variant="label" tone={selected ? 'inverse' : 'default'} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
