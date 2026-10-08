import { useRef, type ReactNode } from 'react';
import { View } from 'react-native';
import { Button, EmptyState, ErrorView, Text, useTheme, type BadgeTone } from '@aidooi/ui-native';
import { useTx } from '../../i18n/useTx.ts';
import { useServices } from '../../providers/AppProviders.tsx';
import { isRegistrationRequired, useRequireSignIn } from '../../session/useRequireSignIn.ts';
import { createIntentKey, type IntentKey } from './payFlow.ts';

/** One idempotency key per user intent, kept for the life of the screen and reset only when the intent ends. */
export function useIntent(): IntentKey {
  const { api } = useServices();
  const ref = useRef<IntentKey | null>(null);
  ref.current ??= createIntentKey(api.uuid);
  return ref.current;
}

/** A guest reached a step that needs an account. Offer sign-in; coming back resumes exactly here. */
export function SignInPrompt({ resumeHref, title }: { resumeHref: string; title?: string }) {
  const t = useTx();
  const requireSignIn = useRequireSignIn();
  return (
    <EmptyState
      icon="lock"
      title={title ?? t('gate.title')}
      message={t('gate.body')}
      action={{ label: t('gate.action'), onPress: () => void requireSignIn(resumeHref) }}
    />
  );
}

/** For a query/mutation error: a guest gets the sign-in prompt, anyone else the translated error with retry. */
export function GatedError({
  error,
  resumeHref,
  onRetry,
}: {
  error: unknown;
  resumeHref: string;
  onRetry?: () => void | Promise<unknown>;
}) {
  if (isRegistrationRequired(error)) return <SignInPrompt resumeHref={resumeHref} />;
  return <ErrorView error={error} {...(onRetry ? { onRetry } : {})} />;
}

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  const { space } = useTheme();
  return (
    <View style={{ gap: space[2] }}>
      {title ? (
        <Text variant="h3" accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

export function Row({
  label,
  children,
  strong,
}: {
  label: string;
  children: ReactNode;
  strong?: boolean;
}) {
  return (
    <View
      style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
      accessible
    >
      <Text variant={strong ? 'label' : 'body'} tone={strong ? 'default' : 'secondary'}>
        {label}
      </Text>
      {children}
    </View>
  );
}

export function PrimaryAction({
  title,
  onPress,
  loading,
}: {
  title: string;
  onPress: () => void | Promise<unknown>;
  loading?: boolean;
}) {
  return <Button title={title} onPress={onPress} {...(loading !== undefined ? { loading } : {})} />;
}

export const toneOf = (state: string): BadgeTone =>
  state === 'Confirmed' ||
  state === 'Completed' ||
  state === 'Receipt Confirmed' ||
  state === 'Paid'
    ? 'ok'
    : state === 'Declined' || state === 'Cancelled' || state === 'No-show' || state === 'Refunded'
      ? 'error'
      : state === 'Pending' || state.startsWith('Awaiting') || state === 'Delivered'
        ? 'warn'
        : 'neutral';
