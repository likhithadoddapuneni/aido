import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from './Icon.tsx';
import { Text } from './Text.tsx';
import { useTheme } from './theme.tsx';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  /** Anything shown before the text: an icon tile, a thumbnail. */
  leading?: ReactNode;
  /** Anything shown at the trailing edge: a price, a badge. */
  trailing?: ReactNode;
  onPress?: () => void;
  /** Show a disclosure chevron (only meaningful with `onPress`). It mirrors in right-to-left layouts. */
  chevron?: boolean;
  accessibilityLabel?: string;
}

export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  onPress,
  chevron = Boolean(onPress),
  accessibilityLabel,
}: ListRowProps) {
  const { color, space, touchTarget } = useTheme();
  const content = (
    <>
      {leading}
      <View style={{ flex: 1, gap: space[1] }}>
        <Text variant="body">{title}</Text>
        {subtitle ? (
          <Text variant="caption" tone="secondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      {chevron ? (
        <View testID="row-chevron" accessibilityElementsHidden importantForAccessibility="no">
          <Icon name="chevron" size={20} tone="secondary" />
        </View>
      ) : null}
    </>
  );
  const style = {
    minHeight: touchTarget,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: space[3],
    paddingVertical: space[3],
    borderBottomWidth: 1,
    borderBottomColor: color.borderSoft,
  };
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, subtitle].filter(Boolean).join(', ')}
      onPress={onPress}
      style={style}
    >
      {content}
    </Pressable>
  ) : (
    <View style={style} {...(accessibilityLabel ? { accessible: true, accessibilityLabel } : {})}>
      {content}
    </View>
  );
}
