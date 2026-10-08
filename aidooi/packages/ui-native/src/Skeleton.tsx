import { useEffect, useRef } from 'react';
import { Animated, type DimensionValue } from 'react-native';
import { useReducedMotion } from './internal/motion.ts';
import { useStrings } from './locale.tsx';
import { useTheme } from './theme.tsx';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  circle?: boolean;
}

/** A loading placeholder. It pulses only when the OS allows motion, and announces itself once as "Loading". */
export function Skeleton({ width = '100%', height, circle = false }: SkeletonProps) {
  const { color, space, radius } = useTheme();
  const s = useStrings();
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  const h = height ?? space[4];

  useEffect(() => {
    if (reduced) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, opacity]);

  return (
    <Animated.View
      accessible
      accessibilityLabel={s('loading')}
      accessibilityRole="progressbar"
      style={{
        width: circle ? h : width,
        height: h,
        borderRadius: circle ? h / 2 : radius.lg,
        backgroundColor: color.sand,
        opacity,
      }}
    />
  );
}
