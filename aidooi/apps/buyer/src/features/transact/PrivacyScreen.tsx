import { useState } from 'react';
import { Share, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Banner,
  Button,
  Card,
  Chip,
  ErrorView,
  Field,
  Screen,
  Text,
  useTheme,
} from '@aidooi/ui-native';
import { ListSkeleton, PageHeader } from '../../components/index.tsx';
import { useTx } from '../../i18n/useTx.ts';
import { useAppState } from '../../providers/AppProviders.tsx';
import { POLICY_VERSION } from '../discovery/SignInScreen.tsx';
import { GatedError, Section } from './parts.tsx';
import { useTransact } from './useTransact.ts';

/** Consent choices, a copy of your data, and the right to be erased. Erasure needs a deliberate confirmation. */
export function PrivacyScreen() {
  const t = useTx();
  const router = useRouter();
  const { space } = useTheme();
  const qc = useQueryClient();
  const tx = useTransact();
  const { signOut } = useAppState();
  const data = useQuery({ queryKey: ['privacy-export'], queryFn: () => tx.exportData() });
  const [typed, setTyped] = useState('');
  const [armed, setArmed] = useState(false);
  const [shown, setShown] = useState<string | null>(null);

  const active = new Set(
    (data.data?.consents ?? []).filter((c) => !c.withdrawnAt).map((c) => c.purpose),
  );
  const toggle = useMutation({
    mutationFn: async (purpose: 'marketing' | 'analytics') =>
      active.has(purpose) ? tx.withdrawConsent(purpose) : tx.grantConsent(purpose, POLICY_VERSION),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['privacy-export'] }),
  });

  const exportIt = useMutation({
    mutationFn: async () => {
      const fresh = await tx.exportData();
      const text = JSON.stringify(fresh, null, 2);
      try {
        await Share.share({ message: text, title: t('privacy.exportTitle') });
      } catch {
        setShown(text); // no share sheet here (web): show it so it can be copied
      }
    },
  });

  const word = t('privacy.eraseWord');
  const confirmed = typed.trim().toLowerCase() === word.toLowerCase();
  const erase = useMutation({
    mutationFn: () => tx.erase(),
    onSuccess: async () => {
      await signOut();
      qc.clear();
      router.replace('/' as never);
    },
  });

  return (
    <Screen>
      <View style={{ gap: space[3] }}>
        <PageHeader title={t('privacy.title')} onBack={() => router.back()} />
        {data.isPending ? <ListSkeleton rows={2} /> : null}
        {data.isError ? (
          <GatedError
            error={data.error}
            resumeHref="/account/privacy"
            onRetry={() => data.refetch()}
          />
        ) : null}
        {data.data ? (
          <Section title={t('privacy.choices')}>
            <Card>
              <View style={{ gap: space[2] }}>
                <Text variant="label">{t('privacy.terms')}</Text>
                <Text variant="caption" tone="secondary">
                  {t('privacy.termsNote')}
                </Text>
              </View>
            </Card>
            {(['marketing', 'analytics'] as const).map((p) => (
              <Card key={p}>
                <View style={{ gap: space[2] }}>
                  <Text variant="label">{t(`privacy.${p}` as never)}</Text>
                  <Text variant="caption" tone="secondary">
                    {t(`privacy.${p}Note` as never)}
                  </Text>
                  <View style={{ alignItems: 'flex-start' }}>
                    <Chip
                      label={active.has(p) ? t('privacy.on') : t('privacy.off')}
                      selected={active.has(p)}
                      onPress={() => void toggle.mutateAsync(p).catch(() => undefined)}
                    />
                  </View>
                </View>
              </Card>
            ))}
            {toggle.isError ? <ErrorView error={toggle.error} /> : null}
          </Section>
        ) : null}

        <Section title={t('privacy.yourData')}>
          <Text tone="secondary">{t('privacy.exportBody')}</Text>
          {exportIt.isError ? <ErrorView error={exportIt.error} /> : null}
          <Button
            title={t('privacy.export')}
            variant="secondary"
            loading={exportIt.isPending}
            onPress={() => exportIt.mutateAsync().catch(() => undefined)}
          />
          {shown ? (
            <Text selectable variant="caption">
              {shown}
            </Text>
          ) : null}
        </Section>

        <Section title={t('privacy.eraseTitle')}>
          <Banner tone="warn" message={t('privacy.eraseBody')} />
          {armed ? (
            <View style={{ gap: space[2] }}>
              <Field
                label={t('privacy.erasePrompt', { word })}
                value={typed}
                onChangeText={setTyped}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {erase.isError ? <ErrorView error={erase.error} /> : null}
              <Button
                title={t('privacy.eraseConfirm')}
                variant="destructive"
                disabled={!confirmed}
                loading={erase.isPending}
                onPress={() => erase.mutateAsync().catch(() => undefined)}
              />
              <Button
                title={t('common.cancel')}
                variant="ghost"
                onPress={() => (setArmed(false), setTyped(''))}
              />
            </View>
          ) : (
            <Button
              title={t('privacy.erase')}
              variant="destructive"
              onPress={() => setArmed(true)}
            />
          )}
        </Section>
      </View>
    </Screen>
  );
}
