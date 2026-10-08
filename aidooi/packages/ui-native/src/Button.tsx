import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Icon, type IconName } from './Icon.tsx';
import { elevate } from './internal/elevate.ts';
import { Text } from './Text.tsx';
import { useTheme } from './theme.tsx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

export interface ButtonProps extends Omit<PressableProps, 'onPress' | 'style' | 'children'> {
  title: string;
  /** May return a promise; the button stays busy — and ignores taps — until it settles. */
  onPress: () => void | Promise<unknown>;
  variant?: ButtonVariant;
  loading?: boolean;
  /** A leading line icon. */
  icon?: IconName | undefined;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  icon,
  disabled = false,
  style,
  accessibilityLabel,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const { color, space, radius, touchTarget } = theme;
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const busy = loading || pending;
  const inactive = disabled || busy;

  const handle = () => {
    // A ref, not state: two taps in the same frame must not both get through before a re-render.
    if (inactive || inFlight.current) return;
    inFlight.current = true;
    const result = onPress();
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      setPending(true);
      void (result as Promise<unknown>).finally(() => {
        inFlight.current = false;
        setPending(false);
      });
    } else {
      inFlight.current = false;
    }
  };

  const palette = {
    primary: { bg: color.navy, pressed: color.navy800, fg: 'inverse' as const, border: color.navy },
    secondary: { bg: color.white, pressed: color.navy050, fg: 'navy' as const, border: color.navy },
    ghost: {
      bg: 'transparent',
      pressed: color.navy050,
      fg: 'navy' as const,
      border: 'transparent',
    },
    destructive: { bg: color.err, pressed: color.err, fg: 'inverse' as const, border: color.err },
  }[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={handle}
      style={({ pressed }) => [
        {
          minHeight: touchTarget + space[1],
          minWidth: touchTarget,
          paddingHorizontal: space[4] + space[1],
          paddingVertical: space[2],
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: palette.border,
          backgroundColor: pressed ? palette.pressed : palette.bg,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: space[2],
          opacity: disabled ? 0.5 : 1,
          ...(variant === 'primary' && !inactive ? elevate(theme, 'sm') : {}),
          ...(pressed ? { transform: [{ scale: 0.98 }] } : {}),
        },
        style,
      ]}
      {...rest}
    >
      {icon && !busy ? (
        <Icon name={icon} size={20} tone={palette.fg === 'inverse' ? 'inverse' : 'navy'} />
      ) : null}
      {busy ? (
        <ActivityIndicator color={palette.fg === 'inverse' ? color.white : color.navy} />
      ) : null}
      <Text variant="label" tone={palette.fg}>
        {title}
      </Text>
    </Pressable>
  );
}
