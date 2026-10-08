import { Pressable } from 'react-native';
import { Icon, type IconName } from './Icon.tsx';
import { Text } from './Text.tsx';
import { useTheme } from './theme.tsx';

/** A selectable filter ("Sofas", "Under AED 5,000"). */
export function Chip({
  label,
  selected = false,
  icon,
  onPress,
}: {
  label: string;
  icon?: IconName | undefined;
  selected?: boolean;
  onPress: () => void;
}) {
  const { color, space, radius, touchTarget } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        minHeight: touchTarget,
        paddingHorizontal: space[3],
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'row',
        gap: space[1],
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? color.navy : color.border,
        backgroundColor: selected ? color.navy : color.white,
      }}
    >
      {icon ? <Icon name={icon} size={18} tone={selected ? 'inverse' : 'navy'} /> : null}
      <Text variant="label" tone={selected ? 'inverse' : 'default'}>
        {label}
      </Text>
    </Pressable>
  );
}
