import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { withIntent } from '@aidooi/api-client';
import { Badge, Banner, Button, Card, ListRow, Screen, Text, useTheme } from '@aidooi/ui-native';
import { PageHeader, ListSkeleton, QueryBoundary } from '../../components/index.tsx';
import { keyFor, useTx } from '../../i18n/useTx.ts';
import { useServices } from '../../providers/AppProviders.tsx';
import { isRegistrationRequired, useRequireSignIn } from '../../session/useRequireSignIn.ts';
import { GatedError, Section, useIntent } from './parts.tsx';
import { useTransact } from './useTransact.ts';

/** AID-LOG-012 §5–12 in the buyer's words. The server decides the amounts; this only explains the rules. */
export function DepositRules() {
  const t = useTx();
  const { space } = useTheme();
  return (
    <Card>
      <View style={{ gap: space[2] }}>
        <Text variant="label" accessibilityRole="header">
          {t('rules.title')}
        </Text>
        {(['deposit', 'purchase', 'noPurchase', 'noShow'] as const).map((k) => (
          <Text key={k} tone="secondary">
            • {t(keyFor('rules', k))}
          </Text>
        ))}
      </View>
    </Card>
  );
}

/**
 * Choose which of the room's products to see in person. Only products a showroom can show are offered;
 * the server groups them by showroom and quotes the deposit once the request exists.
 */
export function ViewingNewScreen({ compositionId }: { compositionId: string }) {
  const t = useTx();
  const router = useRouter();
  const { space } = useTheme();
  const { services } = useServices();
  const tx = useTransact();
  const requireSignIn = useRequireSignIn();
  const intent = useIntent();
  const comp = useQuery({
    queryKey: ['composition', compositionId],
    queryFn: () => services.getComposition(compositionId),
  });
  const [chosen, setChosen] = useState<ReadonlySet<string> | null>(null);
  const href = `/viewing/new?compositionId=${compositionId}`;

  // Start with every viewable product selected.
  useEffect(() => {
    if (comp.data && chosen === null) {
      setChosen(
        new Set(
          comp.data.items
            .filter((i) => i.offer.viewingStatus !== 'Not Viewable')
            .map((i) => i.slotKey),
        ),
      );
    }
  }, [comp.data, chosen]);

  const create = useMutation({
    mutationFn: () =>
      withIntent(
        () => intent.current(),
        (key) => tx.createViewing({ compositionId, itemSlotKeys: [...(chosen ?? [])] }, key),
      ),
    onSuccess: (v) => {
      intent.reset();
      router.replace(`/viewing/${v.id}` as never);
    },
    onError: (e) => {
      if (isRegistrationRequired(e)) void requireSignIn(href);
    },
  });

  const toggle = (slot: string) =>
    setChosen((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(slot)) next.delete(slot);
      else next.add(slot);
      return next;
    });

  return (
    <Screen>
      <View style={{ gap: space[3] }}>
        <PageHeader
          title={t('viewing.newTitle')}
          subtitle={t('viewing.newSubtitle')}
          onBack={() => router.back()}
        />
        <QueryBoundary query={comp} skeleton={<ListSkeleton />}>
          {(c) => (
            <View style={{ gap: space[3] }}>
              <Section title={t('viewing.choose')}>
                {c.items.map((i) => {
                  const viewable = i.offer.viewingStatus !== 'Not Viewable';
                  const on = chosen?.has(i.slotKey) ?? false;
                  return (
                    <ListRow
                      key={i.slotKey}
                      title={i.product.name}
                      subtitle={`${i.offer.location.name} · ${i.offer.location.emirate}`}
                      trailing={
                        <Badge
                          label={t(keyFor('viewing', i.offer.viewingStatus))}
                          tone={i.offer.viewingStatus === 'On Display' ? 'ok' : 'neutral'}
                        />
                      }
                      accessibilityLabel={`${i.product.name}, ${t(
                        viewable
                          ? on
                            ? 'viewing.selected'
                            : 'viewing.notSelected'
                          : 'viewing.unavailable',
                      )}`}
                      {...(viewable ? { onPress: () => toggle(i.slotKey) } : {})}
                    />
                  );
                })}
              </Section>
              <DepositRules />
              <Banner tone="info" message={t('viewing.depositAfter')} />
              {create.isError && !isRegistrationRequired(create.error) ? (
                <GatedError error={create.error} resumeHref={href} />
              ) : null}
              <Button
                title={t('viewing.request')}
                loading={create.isPending}
                disabled={!chosen || chosen.size === 0}
                onPress={() => create.mutateAsync().catch(() => undefined)}
              />
            </View>
          )}
        </QueryBoundary>
      </View>
    </Screen>
  );
}
