import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { withIntent } from '@aidooi/api-client';
import { Screen, Skeleton, Text, useTheme } from '@aidooi/ui-native';
import { useTx } from '../../i18n/useTx.ts';
import { isRegistrationRequired, useRequireSignIn } from '../../session/useRequireSignIn.ts';
import { GatedError, useIntent } from './parts.tsx';
import { useTransact } from './useTransact.ts';

/**
 * Starting a checkout validates every line with its seller and holds the stock. The request carries one
 * idempotency key for this intent, so a retry (or a double render) cannot start two checkouts.
 */
export function CheckoutStartScreen({
  compositionId,
  viewingId,
}: {
  compositionId: string;
  viewingId?: string | undefined;
}) {
  const t = useTx();
  const router = useRouter();
  const { space } = useTheme();
  const tx = useTransact();
  const requireSignIn = useRequireSignIn();
  const intent = useIntent();
  const started = useRef(false);
  const href = `/checkout/start?compositionId=${compositionId}${viewingId ? `&viewingId=${viewingId}` : ''}`;

  const start = useMutation({
    mutationFn: () =>
      withIntent(
        () => intent.current(),
        (key) =>
          tx.startCheckout(
            {
              source: { kind: 'composition', compositionId },
              ...(viewingId ? { viewingRequestId: viewingId } : {}),
            },
            key,
          ),
      ),
    onSuccess: (c) => {
      intent.reset();
      router.replace({ pathname: '/checkout/[id]', params: { id: c.id, compositionId } } as never);
    },
    onError: (e) => {
      if (isRegistrationRequired(e)) void requireSignIn(href);
    },
  });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    start.mutate();
  }, [start]);

  return (
    <Screen>
      <View style={{ gap: space[3] }}>
        {start.isError ? (
          <GatedError
            error={start.error}
            resumeHref={href}
            onRetry={() => start.mutateAsync().catch(() => undefined)}
          />
        ) : (
          <>
            <Text variant="h3" accessibilityLiveRegion="polite">
              {t('checkout.starting')}
            </Text>
            <Skeleton height={88} />
            <Skeleton height={88} />
          </>
        )}
      </View>
    </Screen>
  );
}
