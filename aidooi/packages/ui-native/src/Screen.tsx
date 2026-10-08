import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from './theme.tsx';

export interface ScreenProps {
  children: ReactNode;
  /** Scroll the content (default). Turn off for screens that manage their own scrolling list. */
  scroll?: boolean;
  /** Inset content by the standard page gutter (default). */
  padded?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** Pinned below the content (an action bar). Sits outside the scroll view so it never scrolls away. */
  footer?: ReactNode;
}

/** Ivory page: safe-area insets, keyboard avoidance, and a scroll view that keeps taps working over the keyboard. */
export function Screen({
  children,
  scroll = true,
  padded = true,
  contentStyle,
  footer,
}: ScreenProps) {
  const { color, space } = useTheme();
  const inner: ViewStyle = { flexGrow: 1, gap: space[3], ...(padded ? { padding: space[3] } : {}) };
  const gutter = padded ? space[3] : 0;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.ivory }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {scroll ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[inner, footer ? { paddingBottom: space[4] + gutter } : null, contentStyle]}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[{ flex: 1 }, inner, contentStyle]}>{children}</View>
        )}
        {footer}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
