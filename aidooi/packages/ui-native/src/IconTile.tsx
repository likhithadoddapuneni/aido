import { View } from 'react-native';
import { Icon, type IconName } from './Icon.tsx';
import { useTheme } from './theme.tsx';

/** A rounded tile holding one icon: the leading mark for rows and cards. */
export function IconTile({
  name,
  size = 44,
  tone = 'soft',
}: {
  name: IconName;
  size?: number;
  tone?: 'soft' | 'navy' | 'sand';
}) {
  const { color, radius } = useTheme();
  const bg = { soft: color.navy050, navy: color.navy, sand: color.sand }[tone];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: radius.md + radius.sm / 4,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={name} size={Math.round(size * 0.5)} tone={tone === 'navy' ? 'inverse' : 'navy'} />
    </View>
  );
}
