import { View } from 'react-native';
import { badgeColours, type BadgeTone } from './Badge.tsx';
import { Button } from './Button.tsx';
import { Text } from './Text.tsx';
import { useTheme } from './theme.tsx';

export type BannerTone = Extract<BadgeTone, 'info' | 'warn' | 'error'>;

export interface BannerProps {
  tone?: BannerTone;
  title?: string;
  message: string;
  action?: { label: string; onPress: () => void };
}

/** Inline notice, e.g. "Prices changed — refresh to continue". Warnings and errors are announced. */
export function Banner({ tone = 'info', title, message, action }: BannerProps) {
  const { color, space, radius } = useTheme();
  const c = badgeColours(color)[tone];
  return (
    <View
      // One announcement when it is only text; a banner with a button must stay navigable, so it is not grouped.
      accessible={!action}
      accessibilityRole={tone === 'info' ? undefined : 'alert'}
      accessibilityLiveRegion={tone === 'info' ? 'none' : 'polite'}
      style={{
        gap: space[2],
        padding: space[3],
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.bg,
      }}
    >
      {title ? (
        <Text variant="label" tone={c.text}>
          {title}
        </Text>
      ) : null}
      <Text variant="body" tone={c.text}>
        {message}
      </Text>
      {action ? <Button variant="secondary" title={action.label} onPress={action.onPress} /> : null}
    </View>
  );
}
