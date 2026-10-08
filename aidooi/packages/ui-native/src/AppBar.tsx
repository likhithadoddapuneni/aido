import { Pressable, View } from 'react-native';
import { Icon } from './Icon.tsx';
import { useStrings } from './locale.tsx';
import { Text } from './Text.tsx';
import { useTheme } from './theme.tsx';

/** The top of a pushed screen: a round back control (mirrored in RTL) and an optional small title. */
export function AppBar({
  onBack,
  title,
  trailing,
}: {
  onBack?: (() => void) | undefined;
  title?: string | undefined;
  trailing?: React.ReactNode;
}) {
  const { color, space, touchTarget } = useTheme();
  const s = useStrings();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: touchTarget }}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={s('back')}
          onPress={onBack}
          hitSlop={space[1]}
          style={({ pressed }) => ({
            width: touchTarget,
            height: touchTarget,
            borderRadius: touchTarget / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? color.sand200 : color.white,
            borderWidth: 1,
            borderColor: color.borderSoft,
          })}
        >
          <Icon name="back" size={22} />
        </Pressable>
      ) : null}
      {title ? (
        <Text variant="label" tone="secondary" style={{ flex: 1 }} numberOfLines={1}>
          {title}
        </Text>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      {trailing}
    </View>
  );
}
