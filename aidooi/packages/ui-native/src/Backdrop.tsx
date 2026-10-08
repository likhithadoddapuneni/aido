import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from './theme.tsx';

export type BackdropVariant = 'hero' | 'navy' | 'dawn' | 'room';

/** A two-stop vertical gradient that fills its parent: warm atmosphere behind heroes and art. */
export function Backdrop({ variant = 'hero' }: { variant?: BackdropVariant }) {
  const { gradient } = useTheme();
  const [from, to] = gradient[variant];
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} importantForAccessibility="no">
      <Svg width="100%" height="100%" preserveAspectRatio="none" accessible={false}>
        <Defs>
          <LinearGradient id={`bd-${variant}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#bd-${variant})`} />
      </Svg>
    </View>
  );
}
