import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { elevate } from './internal/elevate.ts';
import { useTheme } from './theme.tsx';

/** A frosted action bar pinned to the bottom of a screen, above the home indicator. */
export function StickyBar({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const { color, space } = theme;
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: color.glass,
        borderTopWidth: 1,
        borderTopColor: color.borderSoft,
        paddingHorizontal: space[3],
        paddingTop: space[2] + space[1],
        paddingBottom: Math.max(insets.bottom, space[2]) + space[1],
        gap: space[2],
        ...elevate(theme, 'lg'),
      }}
    >
      {children}
    </View>
  );
}
