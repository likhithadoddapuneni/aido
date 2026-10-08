import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Banner,
  Button,
  Card,
  ErrorView,
  ListRow,
  Money,
  Screen,
  Text,
  useTheme,
} from '@aidooi/ui-native';
import { PageHeader, ListSkeleton, QueryBoundary } from '../../components/index.tsx';
import { keyFor, useTx } from '../../i18n/useTx.ts';
import { Row, Section } from './parts.tsx';
import { useTransact } from './useTransact.ts';
import { type Checkout } from './services.ts';
import { remaining } from './time.ts';
import { useNow } from './useNow.ts';

/** States in which the answer can change without the buyer doing anything: keep asking. */
const WAITING: ReadonlySet<Checkout['state']> = new Set([
  'Awaiting Seller Confirmation',
  'Payment Requires Action',
]);

/**
 * Where the buyer's checkout stands. Every state the server can report has its own treatment and a clear
 * next step; totals, credit, the 24-hour window and line statuses are shown as the server gave them.
 */
export function CheckoutScreen({
  checkoutId,
  compositionId,
}: {
  checkoutId: string;
  compositionId?: string | undefined;
}) {
  const t = useTx();
  const router = useRouter();
  const { space } = useTheme();
  const tx = useTransact();
  const q = useQuery({
    queryKey: ['checkout', checkoutId],
    queryFn: () => tx.getCheckout(checkoutId),
    refetchInterval: (query) =>
      query.state.data && WAITING.has(query.state.data.state) ? 5000 : false,
  });

  return (
    <Screen>
      <QueryBoundary query={q} skeleton={<ListSkeleton />}>
        {(c) => (
          <View style={{ gap: space[3] }}>
            <PageHeader
              title={t('checkout.title')}
              subtitle={t(keyFor('checkoutState', c.state))}
              onBack={() => router.back()}
            />
            <Lines checkout={c} />
            <Totals checkout={c} />
            <Action checkout={c} compositionId={compositionId} />
          </View>
        )}
      </QueryBoundary>
    </Screen>
  );
}

function Lines({ checkout: c }: { checkout: Checkout }) {
  const t = useTx();
  return (
    <Section title={t('checkout.items')}>
      {c.lines.map((l) => {
        const changed = l.status === 'Price Changed';
        return (
          <ListRow
            key={l.offerId}
            title={`${l.productName} ×${l.quantity}`}
            subtitle={changed ? t('checkout.priceChangedLine') : l.sellerName}
            trailing={
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                {changed ? (
                  <>
                    <Money fils={l.quotedUnitPrice * l.quantity} tone="secondary" />
                    <Money fils={l.currentUnitPrice * l.quantity} />
                  </>
                ) : (
                  <Money fils={l.currentUnitPrice * l.quantity} />
                )}
                <Badge
                  label={t(keyFor('lineStatus', l.status))}
                  tone={
                    l.status === 'Confirmed'
                      ? 'ok'
                      : l.status === 'Awaiting Seller'
                        ? 'warn'
                        : 'error'
                  }
                />
              </View>
            }
          />
        );
      })}
    </Section>
  );
}

function Totals({ checkout: c }: { checkout: Checkout }) {
  const t = useTx();
  const { space } = useTheme();
  if (c.state === 'Rebuild Required') return null;
  return (
    <Card>
      <View style={{ gap: space[2] }}>
        <Row label={t('checkout.total')}>
          <Money fils={c.total} />
        </Row>
        {c.depositCredit > 0 ? (
          <Row label={t('checkout.depositCredit')}>
            <Money fils={-c.depositCredit} tone="navy" />
          </Row>
        ) : null}
        <Row label={t('checkout.payable')} strong>
          <Money fils={c.payable} />
        </Row>
        {c.depositCredit > 0 ? (
          <Text variant="caption" tone="secondary">
            {t('checkout.depositCreditNote')}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

function Action({
  checkout: c,
  compositionId,
}: {
  checkout: Checkout;
  compositionId: string | undefined;
}) {
  const t = useTx();
  const router = useRouter();
  const { space } = useTheme();
  const qc = useQueryClient();
  const tx = useTransact();
  const now = useNow(1000);
  const approve = useMutation({
    mutationFn: () => tx.approvePrices(c.id, c.total),
    onSuccess: (updated) => qc.setQueryData(['checkout', c.id], updated),
  });
  const toPay = () =>
    router.push({ pathname: '/checkout/[id]/pay', params: { id: c.id } } as never);
  const startAgain = () =>
    compositionId
      ? router.replace({ pathname: '/checkout/start', params: { compositionId } } as never)
      : router.replace('/(tabs)/projects' as never);

  switch (c.state) {
    case 'Awaiting Seller Confirmation':
      return (
        <Banner
          tone="info"
          title={t('checkout.waitingTitle')}
          message={t('checkout.waitingBody', { n: c.pendingSellerConfirmations })}
        />
      );
    case 'Awaiting Price Approval':
      return (
        <View style={{ gap: space[3] }}>
          <Banner
            tone="warn"
            title={t('checkout.priceChangedTitle')}
            message={t('checkout.priceChangedBody')}
          />
          {approve.isError ? <ErrorView error={approve.error} /> : null}
          <Button
            title={t('checkout.approve')}
            loading={approve.isPending}
            onPress={() => approve.mutateAsync().catch(() => undefined)}
          />
          <Text variant="caption" tone="secondary">
            {t('checkout.approveNote')}
          </Text>
        </View>
      );
    case 'Ready to Pay': {
      const left = c.expiresAt ? remaining(c.expiresAt, now) : null;
      return (
        <View style={{ gap: space[3] }}>
          {left ? (
            <Banner
              tone={left.hours < 1 ? 'warn' : 'info'}
              message={t('checkout.window', { clock: left.clock })}
            />
          ) : null}
          <Button title={t('checkout.continue')} onPress={toPay} />
        </View>
      );
    }
    case 'Payment Requires Action':
      return (
        <View style={{ gap: space[3] }}>
          <Banner tone="info" message={t('checkout.needsAction')} />
          <Button title={t('checkout.resume')} onPress={toPay} />
        </View>
      );
    case 'Paid':
      return (
        <View style={{ gap: space[3] }}>
          <Banner tone="info" message={t('checkout.paid')} />
          {c.orderId ? (
            <Button
              title={t('checkout.viewOrder')}
              onPress={() => router.replace(`/orders/${c.orderId}` as never)}
            />
          ) : null}
        </View>
      );
    case 'Rebuild Required':
      return (
        <View style={{ gap: space[3] }}>
          <Banner
            tone="error"
            title={t('checkout.rebuildTitle')}
            message={t('checkout.rebuildBody')}
          />
          <Button title={t('checkout.backToOptions')} onPress={startAgain} />
        </View>
      );
    case 'Expired':
      return (
        <View style={{ gap: space[3] }}>
          <Banner
            tone="warn"
            title={t('checkout.expiredTitle')}
            message={t('checkout.expiredBody')}
          />
          <Button title={t('checkout.checkAgain')} onPress={startAgain} />
        </View>
      );
  }
}
