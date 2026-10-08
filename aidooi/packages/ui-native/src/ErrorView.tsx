import { View } from 'react-native';
import { errorMessage } from '@aidooi/i18n';
import { Button } from './Button.tsx';
import { useLocale, useStrings } from './locale.tsx';
import { Text } from './Text.tsx';
import { useTheme } from './theme.tsx';

/** What an `ApiProblem` from `@aidooi/api-client` looks like. Duck-typed so this package needs no network code. */
export interface ProblemLike {
  readonly code: string;
  readonly correlationId?: string | null;
}

export interface ErrorViewProps {
  error: unknown;
  onRetry?: () => void | Promise<unknown>;
}

const isProblem = (e: unknown): e is ProblemLike =>
  typeof e === 'object' &&
  e !== null &&
  typeof (e as ProblemLike).code === 'string' &&
  'status' in e;
const isNetwork = (e: unknown): boolean => e instanceof Error && e.name === 'NetworkError';

/**
 * Never shows a raw code or a stack: a known API code gets its translated message, a dropped connection
 * says so, and anything else is the generic apology. The correlation id is small and selectable so a
 * person can read it to support, who can find the exact request.
 */
export function ErrorView({ error, onRetry }: ErrorViewProps) {
  const { locale } = useLocale();
  const s = useStrings();
  const { space } = useTheme();
  const message = isNetwork(error)
    ? s('offline')
    : errorMessage(isProblem(error) ? error.code : 'internal_error', locale);
  const reference = isProblem(error) ? error.correlationId : null;
  return (
    <View
      // Read as one message — unless it holds a Retry button, which must stay reachable on its own.
      accessible={!onRetry}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{ gap: space[3], alignItems: 'center', padding: space[4] }}
    >
      <Text style={{ textAlign: 'center' }}>{message}</Text>
      {onRetry ? <Button title={s('retry')} onPress={onRetry} /> : null}
      {reference ? (
        <Text variant="caption" tone="secondary" selectable>
          {s('reference')}: {reference}
        </Text>
      ) : null}
    </View>
  );
}
