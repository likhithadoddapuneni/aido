import { View } from 'react-native';
import { Button } from './Button.tsx';
import { IconTile } from './IconTile.tsx';
import type { IconName } from './Icon.tsx';
import { Text } from './Text.tsx';
import { useTheme } from './theme.tsx';

export interface EmptyStateProps {
  title: string;
  message?: string;
  /** A line icon on a soft tile above the title. */
  icon?: IconName;
  action?: { label: string; onPress: () => void };
}

export function EmptyState({ title, message, icon, action }: EmptyStateProps) {
  const { space } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: space[2], padding: space[5] }}>
      {icon ? <IconTile name={icon} size={64} tone="sand" /> : null}
      <Text variant="title" tone="navy" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {message ? (
        <Text tone="secondary" style={{ textAlign: 'center' }}>
          {message}
        </Text>
      ) : null}
      {action ? <Button title={action.label} onPress={action.onPress} /> : null}
    </View>
  );
}
