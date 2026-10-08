import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Banner,
  Button,
  EmptyState,
  ErrorView,
  Card,
  Field,
  Icon,
  IconTile,
  Screen,
  SegmentedControl,
  Text,
  useTheme,
  useToast,
} from '@aidooi/ui-native';
import { PageHeader, ListSkeleton } from '../../components/index.tsx';
import { useTx } from '../../i18n/useTx.ts';
import { useAppState } from '../../providers/AppProviders.tsx';
import { useRequireSignIn } from '../../session/useRequireSignIn.ts';
import { Section } from './parts.tsx';
import { useTransact } from './useTransact.ts';

/** Profile, language and the doors to everything personal. Guests get sign-in and a language switch. */
export function AccountScreen() {
  const t = useTx();
  const router = useRouter();
  const { space, color } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const tx = useTransact();
  const { isGuest, locale, setLanguage, signOut } = useAppState();
  const requireSignIn = useRequireSignIn();
  const me = useQuery({ queryKey: ['me'], queryFn: () => tx.me(), enabled: !isGuest });
  const [name, setName] = useState('');
  const [needsReload, setNeedsReload] = useState(false);

  const customer = me.data?.kind === 'buyer' ? me.data.customer : null;
  useEffect(() => setName(customer?.fullName ?? ''), [customer?.fullName]);

  const save = useMutation({
    mutationFn: () => tx.patchMe({ fullName: name.trim() }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      toast.show({ message: t('account.saved'), tone: 'ok' });
    },
  });
  const changeLanguage = async (next: 'en' | 'ar') => {
    const r = await setLanguage(next);
    setNeedsReload(r.needsReload);
    if (!isGuest) await tx.patchMe({ locale: next }).catch(() => undefined); // keep server-sent messages in the same language
  };

  const language = (
    <Section title={t('language.label')}>
      <SegmentedControl
        accessibilityLabel={t('language.label')}
        value={locale}
        onChange={(v) => void changeLanguage(v)}
        options={[
          { value: 'en', label: 'English' },
          { value: 'ar', label: 'العربية' },
        ]}
      />
      {needsReload ? <Banner tone="info" message={t('language.restart')} /> : null}
    </Section>
  );

  if (isGuest) {
    return (
      <Screen>
        <View style={{ gap: space[3] }}>
          <PageHeader title={t('account.title')} />
          <EmptyState
            icon="user"
            title={t('account.guestTitle')}
            message={t('account.guestBody')}
            action={{
              label: t('gate.action'),
              onPress: () => void requireSignIn('/(tabs)/account'),
            }}
          />
          {language}
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ gap: space[3] }}>
        <PageHeader title={t('account.title')} />
        {me.isPending ? <ListSkeleton rows={2} /> : null}
        {me.isError ? <ErrorView error={me.error} onRetry={() => me.refetch()} /> : null}
        {customer ? (
          <Section title={t('account.profile')}>
            <Field
              label={t('account.name')}
              value={name}
              onChangeText={setName}
              autoComplete="name"
            />
            <Text tone="secondary">{customer.phone ?? customer.email ?? ''}</Text>
            {save.isError ? <ErrorView error={save.error} /> : null}
            <Button
              title={t('account.save')}
              variant="secondary"
              loading={save.isPending}
              disabled={name.trim() === (customer.fullName ?? '') || name.trim().length === 0}
              onPress={() => save.mutateAsync().catch(() => undefined)}
            />
          </Section>
        ) : null}
        {language}
        <Card flush>
          {(
            [
              ['account.viewings', '/viewing', 'calendar'],
              ['account.addresses', '/account/addresses', 'pin'],
              ['account.notifications', '/account/notifications', 'bell'],
              ['account.privacy', '/account/privacy', 'lock'],
            ] as const
          ).map(([key, href, icon], index) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={t(key)}
              onPress={() => router.push(href as never)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space[3],
                padding: space[3],
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: color.borderSoft,
              }}
            >
              <IconTile name={icon} size={40} />
              <Text style={{ flex: 1 }}>{t(key)}</Text>
              <Icon name="chevron" size={20} tone="secondary" />
            </Pressable>
          ))}
        </Card>
        <Button
          title={t('account.signOut')}
          variant="ghost"
          onPress={async () => {
            await signOut();
            qc.clear();
          }}
        />
      </View>
    </Screen>
  );
}
