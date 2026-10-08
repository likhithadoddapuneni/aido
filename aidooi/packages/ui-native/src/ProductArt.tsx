import { useMemo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { productArtSvg, type ArtProduct } from './art.ts';
import { roomSceneSvg, type RoomKind } from './room.ts';
import { Backdrop } from './Backdrop.tsx';
import { useTheme } from './theme.tsx';

export interface ProductArtProps {
  product: ArtProduct;
  /** Square edge in px; the drawing is 4:3 so it letterboxes inside a calm tile. */
  size?: number;
  /** Put the drawing on a warm tile with rounded corners (cards, lists). Off for use over a hero. */
  tile?: boolean;
  /** Mark the image as decorative when the product name sits right beside it. */
  decorative?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The product, drawn from its own record (AID-DATA-012): colour family, material and real proportions —
 * never a stock image, never anything the data does not say.
 */
export function ProductArt({
  product,
  size = 96,
  tile = true,
  decorative = false,
  style,
}: ProductArtProps) {
  const { color, radius } = useTheme();
  const { type, primaryColour, material, widthCm, depthCm, heightCm, name } = product;
  const xml = useMemo(
    () => productArtSvg({ type, primaryColour, material, widthCm, depthCm, heightCm }),
    [type, primaryColour, material, widthCm, depthCm, heightCm],
  );
  const label = `${name ?? type}, ${primaryColour} ${material}`;
  return (
    <View
      testID="product-art"
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={decorative ? undefined : label}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
      style={[
        {
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        },
        tile && { backgroundColor: color.linen, borderRadius: radius.lg },
        style,
      ]}
    >
      <SvgXml xml={xml} width={size} height={(size * 3) / 4} />
    </View>
  );
}

export interface RoomSceneProps {
  kind: RoomKind;
  width: number;
  height: number;
  /** Draw without the warm wall behind it, to sit on a backdrop the caller already provides. */
  bare?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** A calm illustrated room for a path: decorative, so hidden from screen readers. */
export function RoomScene({ kind, width, height, bare = false, style }: RoomSceneProps) {
  const xml = useMemo(() => roomSceneSvg(kind), [kind]);
  return (
    <View
      testID={`room-scene-${kind}`}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[{ width, height, overflow: 'hidden' }, style]}
    >
      {bare ? null : <Backdrop variant="room" />}
      <SvgXml xml={xml} width={width} height={height} />
    </View>
  );
}
