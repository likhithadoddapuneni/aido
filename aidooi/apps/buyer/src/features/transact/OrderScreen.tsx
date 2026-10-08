import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Banner,
  Button,
  Card,
  ErrorView,
  Money,
  Screen,
  StepBar,
  Text,
  useLocale,
  useTheme,
} from '@aidooi/ui-native';
import { PageHeader, ListSkeleton, QueryBoundary } from '../../components/index.tsx';
import { keyFor, useTx } from '../../i18n/useTx.ts';
import { Row, Section, toneOf } from './parts.tsx';
import { useTransact } from './useTransact.ts';
import { type BuyerOrder } from './services.ts';
import { formatDateTime } from './time.ts';

type Line = BuyerOrder['lines'][number];
const CLOSED = new Set(['Cancelled', 'Refunded']);
const PROGRESS: readonly string[] = ['Confirmed', 'In Progress', 'Completed'];

/**
 * One order. The buyer paid once and sees one order: each item has its own progress, but there is nowhere
 * a seller split shows. Receipt confirmation is the buyer's, per item, and starts the seller's payout.
 */
export function OrderScreen({ orderId, placed }: { orderId: string; placed?: boolean }) {
  const t = useTx();
  const router = useRouter();
  const { space } = useTheme();
  const { locale } = useLocale();
  const tx = useTransact();
  const q = useQuery({ queryKey: ['order', orderId], queryFn: () => tx.getOrder(orderId) });

  return (
    <Screen>
      <QueryBoundary query={q} skeleton={<ListSkeleton />}>
        {(o) => (
          <View style={{ gap: space[3] }}>
            <PageHeader
              title={t('order.title')}
              subtitle={t(keyFor('orderStatus', o.status))}
              onBack={() => router.back()}
            />
            {PROGRESS.includes(o.status) ? (
              <StepBar
                step={PROGRESS.indexOf(o.status) + 1}
                of={PROGRESS.length}
                caption={t(keyFor('orderStatus', o.status))}
              />
            ) : null}
            {placed ? (
              <Banner tone="info" title={t('order.thanksTitle')} message={t('order.thanksBody')} />
            ) : null}
            {o.estimatedDeliveryBy ? (
              <Text tone="secondary">
                {t('order.eta', { when: formatDateTime(o.estimatedDeliveryBy, locale) })}
              </Text>
            ) : null}
            <Section title={t('order.items')}>
              {o.lines.map((l) => (
                <LineCard key={l.id} orderId={o.id} line={l} />
              ))}
            </Section>
            <Payment order={o} />
            <Banner tone="info" message={t('order.afterSales')} />
          </View>
        )}
      </QueryBoundary>
    </Screen>
  );
}

function Payment({ order: o }: { order: BuyerOrder }) {
  const t = useTx();
  const { space } = useTheme();
  return (
    <Section title={t('order.payment')}>
      <Card tone="soft">
        <View style={{ gap: space[2] }}>
          <Row label={t('checkout.total')}>
            <Money fils={o.grossFils} />
          </Row>
          {o.depositCreditFils > 0 ? (
            <Row label={t('checkout.depositCredit')}>
              <Money fils={-o.depositCreditFils} tone="navy" />
            </Row>
          ) : null}
          <Row label={t('order.paid')} strong>
            <Money fils={o.paidFils} />
          </Row>
          {o.payment ? (
            <Text variant="caption" tone="secondary">
              {t('order.paymentState', { state: o.payment.state })}
            </Text>
          ) : null}
        </View>
      </Card>
    </Section>
  );
}

function LineCard({ orderId, line: l }: { orderId: string; line: Line }) {
  const t = useTx();
  const router = useRouter();
  const { space } = useTheme();
  const qc = useQueryClient();
  const tx = useTransact();
  const [confirming, setConfirming] = useState(false);
  const receipt = useMutation({
    mutationFn: () => tx.confirmReceipt(orderId, l.id),
    onSuccess: async () => {
      setConfirming(false);
      await qc.invalidateQueries({ queryKey: ['order', orderId] });
      await qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  return (
    <Card>
      <View
        style={{ gap: space[2] }}
        accessibilityLabel={`${l.productName}, ${t(keyFor('lineState', l.state))}`}
      >
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: space[2],
          }}
        >
          <Text variant="label" style={{ flex: 1 }}>
            {l.productName} ×{l.quantity}
          </Text>
          <Money fils={l.grossLineFils} />
        </View>
        <View style={{ flexDirection: 'row', gap: space[2], flexWrap: 'wrap' }}>
          <Badge label={t(keyFor('lineState', l.state))} tone={toneOf(l.state)} />
          {l.openIssues.map((i) => (
            <Badge
              key={i.id}
              label={`${t(keyFor('issueFlag', i.flag))} · ${t(keyFor('issueState', i.state))}`}
              tone="warn"
            />
          ))}
        </View>
        {receipt.isError ? <ErrorView error={receipt.error} /> : null}
        {l.state === 'Delivered' ? (
          confirming ? (
            <View style={{ gap: space[2] }}>
              <Text tone="secondary">{t('order.confirmReceiptNote')}</Text>
              <Button
                title={t('order.confirmReceiptYes')}
                loading={receipt.isPending}
                onPress={() => receipt.mutateAsync().catch(() => undefined)}
              />
            </View>
          ) : (
            <Button title={t('order.confirmReceipt')} onPress={() => setConfirming(true)} />
          )
        ) : null}
        {!CLOSED.has(l.state) ? (
          <View style={{ alignItems: 'flex-start' }}>
            <Button
              variant="ghost"
              title={t('order.report')}
              onPress={() =>
                router.push({
                  pathname: '/orders/[id]/issue',
                  params: { id: orderId, lineId: l.id },
                } as never)
              }
            />
          </View>
        ) : null}
      </View>
    </Card>
  );
}
