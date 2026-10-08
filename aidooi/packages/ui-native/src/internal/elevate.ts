import type { ViewStyle } from 'react-native';
import type { Theme } from '../theme.tsx';

export type Elevation = keyof Theme['elevation'];

/** Native shadow style for one elevation step (iOS shadow*, Android elevation, web via RN's shadow props). */
export function elevate(theme: Theme, level: Elevation): ViewStyle {
  const e = theme.elevation[level];
  return {
    shadowColor: e.shadowColor,
    shadowOpacity: e.shadowOpacity,
    shadowRadius: e.shadowRadius,
    shadowOffset: { width: 0, height: e.shadowOffsetY },
    elevation: e.android,
  };
}
