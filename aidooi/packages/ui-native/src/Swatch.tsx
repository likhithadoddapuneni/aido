import { Pressable, View } from 'react-native';
import { art } from '@aidooi/ui-tokens';
import { Icon } from './Icon.tsx';
import { Text } from './Text.tsx';
import { useTheme } from './theme.tsx';

/** A selectable colour family. The disc is the same tone product art uses for that family. */
export function Swatch({
  colour,
  label,
  selected,
  onPress,
}: {
  /** The colour family key, e.g. `beige`. */
  colour: string;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { color, space, radius } = useTheme();
  const fill = (art.tone as Record<string, string>)[colour] ?? art.fallbackTone;
  const dark = colour === 'black' || colour === 'navy' || colour === 'brown' || colour === 'blue';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{ width: space[7] + space[2], alignItems: 'center', gap: space[1], paddingVertical: space[1] }}
    >
      <View
        style={{
          width: space[6],
          height: space[6],
          borderRadius: radius.pill,
          backgroundColor: fill,
          borderWidth: selected ? 3 : 1,
          borderColor: selected ? color.navy : color.border,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected ? <Icon name="check" size={20} tone={dark ? 'inverse' : 'navy'} /> : null}
      </View>
      <Text variant="caption" tone={selected ? 'navy' : 'secondary'} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}
