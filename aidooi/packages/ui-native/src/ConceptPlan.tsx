import { useMemo } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { Badge } from './Badge.tsx';
import { useStrings } from './locale.tsx';
import { planSvg } from './planArt.ts';
import { layoutPlan, type PlanItem } from './planLayout.ts';
import { Text } from './Text.tsx';
import { useTheme } from './theme.tsx';

export interface ConceptPlanProps {
  roomWidthCm: number;
  roomDepthCm: number;
  items: readonly PlanItem[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Drawing width in px. Defaults to the screen width less the page gutter. */
  width?: number;
}

/** Below this size a shape is too small to hold its label legibly; the label stays available to screen readers. */
const MIN_LABEL_PX = 56;

/**
 * A measured top-down plan drawn from verified product dimensions, always labelled "Concept": it is a
 * plan, not a photograph (AID-LOG-011). The drawing is SVG; tapping is done by transparent pressables on
 * top, so every shape is a real, labelled accessibility element. Plans are physical geometry and do not
 * mirror in right-to-left layouts.
 */
export function ConceptPlan({
  roomWidthCm,
  roomDepthCm,
  items,
  selectedId = null,
  onSelect,
  width,
}: ConceptPlanProps) {
  const { color, space, radius } = useTheme();
  const s = useStrings();
  const screen = useWindowDimensions().width;
  const px = width ?? Math.max(0, screen - space[3] * 2);
  const layout = useMemo(
    () => layoutPlan({ roomWidthCm, roomDepthCm, items }),
    [roomWidthCm, roomDepthCm, items],
  );
  const scale = px / roomWidthCm;
  const height = Math.round(roomDepthCm * scale);
  const xml = useMemo(
    () =>
      planSvg({
        px,
        height,
        scale,
        roomWidthCm,
        roomDepthCm,
        placed: layout.placed,
        selectedId,
      }),
    [px, height, scale, roomWidthCm, roomDepthCm, layout.placed, selectedId],
  );
  // Larger shapes first so a smaller piece resting on one (a table on a rug) stays on top and tappable.
  const ordered = useMemo(
    () => [...layout.placed].sort((a, b) => b.widthCm * b.depthCm - a.widthCm * a.depthCm),
    [layout.placed],
  );
  // A shape with another resting on it yields its label to the smaller piece.
  const covered = useMemo(() => {
    const ids = new Set<string>();
    for (const a of layout.placed) {
      for (const b of layout.placed) {
        if (a.id === b.id || a.widthCm * a.depthCm <= b.widthCm * b.depthCm) continue;
        const ox = Math.min(a.x + a.widthCm, b.x + b.widthCm) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.depthCm, b.y + b.depthCm) - Math.max(a.y, b.y);
        if (ox > 0 && oy > 0) ids.add(a.id);
      }
    }
    return ids;
  }, [layout.placed]);
  const metres = (cm: number) => `${(cm / 100).toFixed(1)} m`;

  return (
    <View style={{ gap: space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <Badge label={s('concept')} tone="neutral" />
        <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
          {s('conceptNote')}
        </Text>
      </View>
      <View
        testID="concept-plan"
        accessible={false}
        accessibilityLabel={s('planSummary', {
          width: roomWidthCm,
          depth: roomDepthCm,
          count: layout.placed.length,
        })}
        style={{ width: px, height, direction: 'ltr' }}
      >
        <View style={{ position: 'absolute', top: 0, left: 0, borderRadius: radius.lg, overflow: 'hidden' }}>
          <SvgXml xml={xml} width={px} height={height} />
        </View>
        {ordered.map((p) => {
          const w = p.widthCm * scale;
          const h = p.depthCm * scale;
          return (
            <Pressable
              key={p.id}
              testID={`plan-item-${p.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${p.label}, ${p.widthCm} × ${p.depthCm} cm`}
              accessibilityState={{ selected: p.id === selectedId }}
              onPress={() => onSelect?.(p.id)}
              style={{
                position: 'absolute',
                left: p.x * scale,
                top: p.y * scale,
                width: w,
                height: h,
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              {w >= MIN_LABEL_PX && h >= space[4] && !covered.has(p.id) ? (
                <View
                  style={{
                    backgroundColor: color.glass,
                    borderRadius: radius.sm,
                    paddingHorizontal: space[1],
                    maxWidth: '96%',
                  }}
                >
                  <Text
                    variant="caption"
                    tone="navy"
                    numberOfLines={2}
                    style={{ textAlign: 'center' }}
                  >
                    {p.label}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', direction: 'ltr' }}>
        <Text variant="caption" tone="secondary">
          {metres(roomWidthCm)} × {metres(roomDepthCm)}
        </Text>
      </View>
      {layout.unplaced.length > 0 ? (
        <Text variant="caption" tone="warn">
          {s('unplaced', { count: layout.unplaced.length })}
        </Text>
      ) : null}
    </View>
  );
}
