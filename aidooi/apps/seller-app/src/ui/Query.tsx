import type { ReactNode } from 'react';
import { ErrorView, Skeleton, useTheme } from '@aidooi/ui-native';
import { View } from 'react-native';

/** The three states every list has: loading, failed (with retry), or ready. */
export function QueryState({
  loading,
  error,
  onRetry,
  children,
}: {
  loading: boolean;
  error: unknown;
  onRetry: () => void | Promise<unknown>;
  children: ReactNode;
}) {
  const { space } = useTheme();
  if (error) return <ErrorView error={error} onRetry={onRetry} />;
  if (loading)
    return (
      <View style={{ gap: space[3] }} accessibilityRole="progressbar">
        <Skeleton height={88} />
        <Skeleton height={88} />
        <Skeleton height={88} />
      </View>
    );
  return <>{children}</>;
}
