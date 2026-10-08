import { useState } from 'react';
import { View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiProblem, withIntent } from '@aidooi/api-client';
import {
  Badge,
  Banner,
  Button,
  Card,
  Chip,
  ErrorView,
  Money,
  Screen,
  Text,
  useLocale,
  useTheme,
} from '@aidooi/ui-native';
import type { Viewing } from './services.ts';
import { PageHeader, ListSkeleton, QueryBoundary } from '../../components/index.tsx';
import { keyFor, useTx } from '../../i18n/useTx.ts';
import { DepositRules } from './ViewingNewScreen.tsx';
import { Row, Section, toneOf, useIntent } from './parts.tsx';
import { classifyPayError } from './payFlow.ts';
import { resolvePaymentSheet, PaymentCancelled, PaymentNotConfigured } from './payment/index.ts';
import { pollUntil } from './poll.ts';
import { useTransact } from './useTransact.ts';
import { formatDateTime, formatDay, formatTime, remaining, visitSlots } from './time.ts';
import { useNow, wallClockMs } from './useNow.ts';

const mapsUrl = (address: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

/** Where a viewing stands, what the buyer must do next, and nothing computed on the phone. */
export function ViewingScreen({ viewingId }: { viewingId: string }) {
  const t = useTx();
  const router = useRouter();
  const { space } = useTheme();
  const tx = useTransact();
  const q = useQuery({
    queryKey: ['viewing', viewingId],
    queryFn: () => tx.getViewing(viewingId),
    // While showrooms are answering, ask again; once decided the screen stops asking.
    refetchInterval: (query) =>
      query.state.data?.state === 'Awaiting Seller Confirmation' ? 10_000 : false,
  });

  return (
    <Screen>
      <QueryBoundary query={q} skeleton={<ListSkeleton />}>
        {(v) => (
          <View style={{ gap: space[3] }}>
            <PageHeader
              title={t('viewing.title')}
              subtitle={t(keyFor('viewingState', v.state))}
              onBack={() => router.back()}
            />
            <Stops viewing={v} />
            <Next viewing={v} />
          </View>
        )}
      </QueryBoundary>
    </Screen>
  );
}

function Stops({ viewing }: { viewing: Viewing }) {
  const t = useTx();
  const { space } = useTheme();
  return (
    <Section title={t('viewing.stops')}>
      {viewing.stops.map((s) => (
        <Card key={s.id}>
          <View
            style={{ gap: space[2] }}
            accessibilityLabel={`${s.partnerName}, ${s.locationName}`}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text variant="label">
                {t('viewing.stopNo', { n: s.stopNo })} · {s.locationName}
              </Text>
              <Badge label={t(keyFor('stop', s.confirmation))} tone={toneOf(s.confirmation)} />
            </View>
            <Text tone="secondary">{s.address}</Text>
            {s.products.map((p) => (
              <Text key={p.offerId} variant="caption" tone="secondary">
                • {p.name} ×{p.quantity}
              </Text>
            ))}
            <View style={{ alignItems: 'flex-start' }}>
              <Button
                variant="ghost"
                title={t('viewing.openMaps')}
                onPress={() => void Linking.openURL(mapsUrl(s.address))}
              />
            </View>
          </View>
        </Card>
      ))}
    </Section>
  );
}

function Next({ viewing }: { viewing: Viewing }) {
  const t = useTx();
  const router = useRouter();
  const { space } = useTheme();
  const qc = useQueryClient();
  const tx = useTransact();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const setViewing = (v: Viewing) => qc.setQueryData(['viewing', v.id], v);
  const cont = useMutation({
    mutationFn: () => tx.continueViewing(viewing.id),
    onSuccess: setViewing,
  });
  const cancel = useMutation({
    mutationFn: () => tx.cancelViewing(viewing.id),
    onSuccess: (v) => {
      setViewing(v);
      setConfirmCancel(false);
    },
  });

  const cancellable = [
    'Draft',
    'Awaiting Seller Confirmation',
    'Awaiting Deposit',
    'Confirmed',
  ].includes(viewing.state);
  const cancelBlock = cancellable ? (
    <View style={{ gap: space[2] }}>
      {cancel.isError ? <ErrorView error={cancel.error} /> : null}
      {confirmCancel ? (
        <>
          <Text tone="secondary">
            {t(viewing.deposit?.state === 'Paid' ? 'viewing.cancelRefund' : 'viewing.cancelFree')}
          </Text>
          <Button
            title={t('viewing.cancelConfirm')}
            variant="destructive"
            loading={cancel.isPending}
            onPress={() => cancel.mutateAsync().catch(() => undefined)}
          />
        </>
      ) : (
        <Button
          title={t('viewing.cancel')}
          variant="ghost"
          onPress={() => setConfirmCancel(true)}
        />
      )}
    </View>
  ) : null;

  if (viewing.needsDecision) {
    return (
      <View style={{ gap: space[3] }}>
        <Banner
          tone="warn"
          title={t('viewing.declinedTitle')}
          message={t('viewing.declinedBody')}
        />
        {cont.isError ? <ErrorView error={cont.error} /> : null}
        <Button
          title={t('viewing.continueWithout')}
          loading={cont.isPending}
          onPress={() => cont.mutateAsync().catch(() => undefined)}
        />
        {cancelBlock}
      </View>
    );
  }

  switch (viewing.state) {
    case 'Awaiting Seller Confirmation':
      return (
        <View style={{ gap: space[3] }}>
          <Banner tone="info" message={t('viewing.waiting')} />
          {cancelBlock}
        </View>
      );
    case 'Awaiting Deposit':
      return (
        <View style={{ gap: space[3] }}>
          <DepositSection viewing={viewing} />
          {cancelBlock}
        </View>
      );
    case 'Confirmed':
      return (
        <View style={{ gap: space[3] }}>
          <Confirmed viewing={viewing} />
          <Button
            title={t('viewing.showPass')}
            onPress={() => router.push(`/viewing/${viewing.id}/pass` as never)}
          />
          {cancelBlock}
        </View>
      );
    case 'Completed':
      return (
        <View style={{ gap: space[3] }}>
          <Banner
            tone="info"
            title={t('viewing.completedTitle')}
            message={t(
              viewing.deposit?.state === 'Credited'
                ? 'viewing.depositCredited'
                : 'viewing.completedBody',
            )}
          />
          {viewing.compositionId && viewing.deposit?.state !== 'Credited' ? (
            <Button
              title={t('viewing.buyNow')}
              onPress={() =>
                router.push({
                  pathname: '/checkout/start',
                  params: { compositionId: viewing.compositionId, viewingId: viewing.id },
                } as never)
              }
            />
          ) : null}
        </View>
      );
    case 'No-show':
      return <Banner tone="warn" message={t('viewing.noShow')} />;
    case 'Cancelled':
      return <Banner tone="info" message={t('viewing.cancelled')} />;
    default:
      return null;
  }
}

function Confirmed({ viewing }: { viewing: Viewing }) {
  const t = useTx();
  const { locale } = useLocale();
  const now = useNow(1000);
  if (!viewing.scheduledAt) return null;
  const left = remaining(viewing.scheduledAt, now);
  return (
    <Card>
      <View style={{ gap: 8 }}>
        <Text variant="label">{t('viewing.yourVisit')}</Text>
        <Text variant="h3">{formatDateTime(viewing.scheduledAt, locale)}</Text>
        {left.expired ? null : (
          <Text
            tone="secondary"
            accessibilityLabel={t('viewing.countdownLabel', { clock: left.clock })}
          >
            {t('viewing.countdown', { clock: left.clock })}
          </Text>
        )}
      </View>
    </Card>
  );
}

/** The deposit: the quote from the server, the plain rules, a time to visit, and the payment sheet. */
function DepositSection({ viewing }: { viewing: Viewing }) {
  const t = useTx();
  const { space } = useTheme();
  const { locale } = useLocale();
  const qc = useQueryClient();
  const tx = useTransact();
  const intent = useIntent();
  const slots = visitSlots(wallClockMs());
  const [slotIso, setSlotIso] = useState<string | null>(slots[0]?.iso ?? null);
  const [day, setDay] = useState<number>(slots[0]?.dayOffset ?? 0);
  const days = [...new Set(slots.map((s) => s.dayOffset))];
  const [banner, setBanner] = useState<'cancelled' | 'none-configured' | 'bank' | null>(null);

  const pay = useMutation({
    mutationFn: async () => {
      setBanner(null);
      const sheet = resolvePaymentSheet();
      let token: string;
      try {
        token = await sheet.getPaymentToken();
      } catch (e) {
        if (e instanceof PaymentCancelled) {
          setBanner('cancelled');
          return null;
        }
        if (e instanceof PaymentNotConfigured) {
          setBanner('none-configured');
          return null;
        }
        throw e;
      }
      const result = await withIntent(
        () => intent.current(),
        (key) =>
          tx.payDeposit(viewing.id, { paymentToken: token, scheduledAt: slotIso as string }, key),
      );
      if (result.status === 'confirmed') return result.viewing;
      // The bank wants the buyer to authenticate: open its page, then ask until the server knows.
      setBanner('bank');
      await WebBrowser.openBrowserAsync(result.actionUrl);
      return (
        (await pollUntil({
          probe: async () => {
            const v = await tx.getViewing(viewing.id);
            return v.state === 'Awaiting Deposit' ? undefined : v;
          },
        })) ?? null
      );
    },
    onSuccess: (v) => {
      if (v) {
        intent.reset();
        setBanner(null);
        qc.setQueryData(['viewing', viewing.id], v);
      }
    },
    onError: (e) => {
      const a = classifyPayError(e);
      // A refused card ends this attempt: the next card is a new payment, so a new key.
      if (a.kind === 'declined' || a.kind === 'restart') intent.reset();
    },
  });

  return (
    <View style={{ gap: space[3] }}>
      <Section title={t('viewing.deposit')}>
        <Card>
          <View style={{ gap: space[2] }}>
            <Row label={t('viewing.depositAmount')} strong>
              <Money fils={viewing.depositQuote.amount} />
            </Row>
            <Text variant="caption" tone="secondary">
              {t(viewing.depositQuote.capped ? 'viewing.depositCapped' : 'viewing.depositFive')}
            </Text>
          </View>
        </Card>
      </Section>
      <DepositRules />
      <Section title={t('viewing.whenTitle')}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          {days.map((d) => {
            const first = slots.find((s) => s.dayOffset === d)!;
            return (
              <Chip
                key={d}
                label={formatDay(first.iso, locale)}
                selected={day === d}
                onPress={() => {
                  setDay(d);
                  setSlotIso(slots.find((s) => s.dayOffset === d)?.iso ?? null);
                }}
              />
            );
          })}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
          {slots
            .filter((s) => s.dayOffset === day)
            .map((s) => (
              <Chip
                key={s.iso}
                label={formatTime(s.iso, locale)}
                selected={slotIso === s.iso}
                onPress={() => setSlotIso(s.iso)}
              />
            ))}
        </View>
      </Section>
      {banner === 'cancelled' ? <Banner tone="info" message={t('pay.cancelled')} /> : null}
      {banner === 'none-configured' ? (
        <Banner tone="warn" message={t('pay.notConfigured')} />
      ) : null}
      {banner === 'bank' ? <Banner tone="info" message={t('pay.waitingBank')} /> : null}
      {pay.isError ? (
        <View style={{ gap: space[2] }}>
          <ErrorView
            error={pay.error}
            {...(pay.error instanceof ApiProblem && pay.error.code === 'payment_declined'
              ? {}
              : { onRetry: () => pay.mutateAsync().catch(() => undefined) })}
          />
          {classifyPayError(pay.error).kind === 'retry' ? (
            <Text variant="caption" tone="secondary">
              {t('pay.safeRetry')}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Button
        title={t('viewing.payDeposit')}
        loading={pay.isPending}
        disabled={!slotIso}
        onPress={() => pay.mutateAsync().catch(() => undefined)}
      />
    </View>
  );
}
