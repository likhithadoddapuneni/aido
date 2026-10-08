import { Pressable, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { elevate, type Elevation } from './internal/elevate.ts';
import { useTheme } from './theme.tsx';

export interface CardProps extends ViewProps {
  /** Makes the whole card a button. */
  onPress?: () => void;
  accessibilityLabel?: string;
  /** `raised` floats on white with a soft shadow; `soft` is the quiet tinted panel; `ink` is the one dark moment. */
  tone?: 'raised' | 'soft' | 'ink' | 'selected';
  elevation?: Elevation;
  /** Remove the inner padding, for cards that hold full-bleed art. */
  flush?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Card({
  onPress,
  accessibilityLabel,
  tone = 'raised',
  elevation,
  flush = false,
  style,
  children,
  ...rest
}: CardProps) {
  const theme = useTheme();
  const { color, space, radius } = theme;
  const palette = {
    raised: { bg: color.white, border: color.borderSoft, press: color.surface2, lift: 'sm' },
    soft: { bg: color.surface, border: color.border, press: color.surface2, lift: 'none' },
    ink: { bg: color.ink, border: color.ink, press: color.navy800, lift: 'md' },
    selected: { bg: color.white, border: color.navy, press: color.navy050, lift: 'md' },
  }[tone] as { bg: string; border: string; press: string; lift: Elevation };
  const base: ViewStyle = {
    backgroundColor: palette.bg,
    borderRadius: radius.xl,
    borderWidth: tone === 'selected' ? 2 : 1,
    borderColor: palette.border,
    padding: flush ? 0 : space[3],
    gap: flush ? 0 : space[2],
    overflow: flush ? 'hidden' : 'visible',
    ...elevate(theme, elevation ?? palette.lift),
  };
  if (!onPress) {
    return (
      <View style={[base, style]} {...rest}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={tone === 'selected' ? { selected: true } : undefined}
      onPress={onPress}
      style={({ pressed }) => [
        base,
        pressed && { backgroundColor: palette.press, transform: [{ scale: 0.985 }] },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}
