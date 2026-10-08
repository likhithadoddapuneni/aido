import { useMemo } from 'react';
import { encode } from 'uqr';
import Svg, { Path, Rect } from 'react-native-svg';
import { useTheme } from '@aidooi/ui-native';

/**
 * The module matrix as one SVG path: a horizontal run of dark modules becomes one rectangle, so a code of
 * several hundred modules is a short string rather than a thousand elements. Pure, so it is testable.
 */
export function qrPath(matrix: readonly (readonly boolean[])[], quiet: number): string {
  const parts: string[] = [];
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x++;
      parts.push(`M${start + quiet} ${y + quiet}h${x - start}v1h-${x - start}z`);
    }
  });
  return parts.join('');
}

export const QUIET_ZONE = 4;

export function qrMatrix(value: string): boolean[][] {
  // Medium error correction: a scratched or glare-hit screen still scans.
  return encode(value, { ecc: 'M', border: 0 }).data;
}

/** A scannable QR code drawn from `value`. Dark on white at full contrast whatever the theme: scanners need it. */
export function QrCode({ value, size, label }: { value: string; size: number; label: string }) {
  const { color } = useTheme();
  const matrix = useMemo(() => qrMatrix(value), [value]);
  const path = useMemo(() => qrPath(matrix, QUIET_ZONE), [matrix]);
  const span = matrix.length + QUIET_ZONE * 2;
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${span} ${span}`}
      accessibilityRole="image"
      accessibilityLabel={label}
    >
      <Rect width={span} height={span} fill={color.white} />
      <Path d={path} fill={color.text} />
    </Svg>
  );
}
