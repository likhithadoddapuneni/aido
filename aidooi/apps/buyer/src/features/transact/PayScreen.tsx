import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiProblem, withIntent } from '@aidooi/api-client';
import {
  Banner,
  Button,
  Card,
  Chip,
  ErrorView,
  Money,
  Screen,
  Text,
  useTheme,
} from '@aidooi/ui-native';
import { PageHeader, ListSkeleton, QueryBoundary } from '../../components/index.tsx';
import { useTx } from '../../i18n/useTx.ts';
import { isRegistrationRequired, useRequireSignIn } from '../../session/useRequireSignIn.ts';
import {
  DeliveryForm,
  emptyDraft,
  parseDelivery,
  type DeliveryDraft,
  type DeliveryErrors,
} from './DeliveryForm.tsx';
import { Row, Section, useIntent } from './parts.tsx';
import { classifyPayError } from './payFlow.ts';
import {
  loadDemoPayments,
  PaymentCancelled,
  PaymentNotConfigured,
  resolvePaymentSheet,
} from './payment/index.ts';
import { pollUntil } from './poll.ts';
import { useTransact } from './useTransact.ts';
import { type Checkout } from './services.ts';

type Phase =
  | { kind: 'form' }
  | { kind: 'cancelled' }
  | { kind: 'not-configured' }
  | { kind: 'bank' }
  | { kind: 'bank-timeout' }
  | { kind: 'in-progress' }
  | { kind: 'changed' };

/**
 * Pay. One payment to AIDOOi for the whole order. What this screen guarantees:
 *
 *  - the card is collected by the payment provider's sheet (behind `PaymentSheet`); only a token is sent;
 *  - one idempotency key per intent to pay, kept across every retry, so a timeout whose outcome is unknown
 *    can never charge twice;
 *  - a declined card is the end of that attempt — the next card is a new intent with a new key;
 *  - when the bank asks for authentication, the app opens it and then asks the server until it knows.
 */
export function PayScreen({ checkoutId }: { checkoutId: string }) {
  const t = useTx();
  const router = useRouter();
  const { space } = useTheme();
  const tx = useTransact();
  const checkout = useQuery({
    queryKey: ['checkout', checkoutId],
    queryFn: () => tx.getCheckout(checkoutId),
  });

  return (
    <Screen>
      <View style={{ gap: space[3] }}>
        <PageHeader title={t('pay.title')} onBack={() => router.back()} />
        <QueryBoundary query={checkout} skeleton={<ListSkeleton />}>
          {(c) => <PayForm checkout={c} />}
        </QueryBoundary>
      </View>
    </Screen>
  );
}

function PayForm({ checkout }: { checkout: Checkout }) {
  const t = useTx();
  const router = useRouter();
  const { space } = useTheme();
  const qc = useQueryClient();
  const tx = useTransact();
  const intent = useIntent();
  const requireSignIn = useRequireSignIn();
  const demo = useMemo(() => loadDemoPayments(), []);
  const [scenario, setScenario] = useState(demo?.selected() ?? 'ok');
  const [draft, setDraft] = useState<DeliveryDraft>(emptyDraft);
  const [errors, setErrors] = useState<DeliveryErrors>({});
  const [saveAddress, setSaveAddress] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });

  const me = useQuery({ queryKey: ['me'], queryFn: () => tx.me() });
  const addresses = useQuery({ queryKey: ['addresses'], queryFn: () => tx.listAddresses() });
  const saved = addresses.data ?? [];

  // Start from what we know: the customer's name and number, and their default address.
  useEffect(() => {
    if (!me.data || me.data.kind !== 'buyer' || !me.data.customer) return;
    const c = me.data.customer;
    const def = saved.find((a) => a.isDefault);
    setDraft((d) => ({
      ...d,
      recipientName: d.recipientName || c.fullName || '',
      phone: d.phone || c.phone || '',
      ...(def && !d.line1
        ? { line1: def.line1, line2: def.line2 ?? '', area: def.area ?? '', emirate: def.emirate }
        : {}),
    }));
  }, [me.data, saved]);

  const href = `/checkout/${checkout.id}/pay`;
  const goToOrder = async (orderId: string) => {
    intent.reset();
    void qc.invalidateQueries({ queryKey: ['orders'] });
    router.replace({ pathname: '/orders/[id]', params: { id: orderId, placed: '1' } } as never);
  };

  const pay = useMutation({
    mutationFn: async () => {
      const parsed = parseDelivery(draft);
      if (!parsed.ok) {
        setErrors(parsed.errors);
        return null;
      }
      setErrors({});
      setPhase({ kind: 'form' });

      let token: string;
      try {
        token = await resolvePaymentSheet().getPaymentToken();
      } catch (e) {
        if (e instanceof PaymentCancelled) setPhase({ kind: 'cancelled' });
        else if (e instanceof PaymentNotConfigured) setPhase({ kind: 'not-configured' });
        else throw e;
        return null;
      }

      const result = await withIntent(
        () => intent.current(),
        (key) => tx.pay(checkout.id, { paymentToken: token, delivery: parsed.value }, key),
        { attempts: 3 },
      );
      if (result.status === 'paid') return { orderId: result.orderId, save: parsed.value };

      // 3-D Secure: the bank's page, then ask the server until it knows the outcome.
      setPhase({ kind: 'bank' });
      await WebBrowser.openBrowserAsync(result.actionUrl);
      const settled = await pollUntil({
        probe: async () => {
          const c = await tx.getCheckout(checkout.id);
          return c.state === 'Payment Requires Action' ? undefined : c;
        },
      });
      if (!settled) {
        setPhase({ kind: 'bank-timeout' });
        return null;
      }
      if (settled.state === 'Paid' && settled.orderId)
        return { orderId: settled.orderId, save: parsed.value };
      // The bank refused or the attempt lapsed: this attempt is over.
      intent.reset();
      qc.setQueryData(['checkout', checkout.id], settled);
      setPhase({ kind: 'form' });
      throw new ApiProblem({ status: 402, code: 'authentication_failed' });
    },
    onSuccess: async (r) => {
      if (!r) return;
      if (saveAddress) {
        await tx
          .createAddress({
            line1: r.save.line1,
            ...(r.save.line2 ? { line2: r.save.line2 } : {}),
            ...(r.save.area ? { area: r.save.area } : {}),
            emirate: r.save.emirate,
            isDefault: saved.length === 0,
          })
          .catch(() => undefined); // best effort: the order is already placed
      }
      await goToOrder(r.orderId);
    },
    onError: async (e) => {
      const action = classifyPayError(e);
      if ('resetKey' in action || action.kind === 'declined') intent.reset();
      if (action.kind === 'sign-in' || isRegistrationRequired(e)) void requireSignIn(href);
      if (action.kind === 'checkout-changed') {
        await qc.invalidateQueries({ queryKey: ['checkout', checkout.id] });
        setPhase({ kind: 'changed' });
      }
      if (action.kind === 'in-progress') {
        setPhase({ kind: 'in-progress' });
        const c = await pollUntil({
          probe: async () => {
            const next = await tx.getCheckout(checkout.id);
            return next.state === 'Paid' ? next : undefined;
          },
          maxMs: 60_000,
        });
        if (c?.orderId) await goToOrder(c.orderId);
        else setPhase({ kind: 'form' });
      }
    },
  });

  const error = pay.isError ? classifyPayError(pay.error) : null;
  return (
    <View style={{ gap: space[3] }}>
      <Card>
        <View style={{ gap: space[2] }}>
          <Row label={t('checkout.total')}>
            <Money fils={checkout.total} />
          </Row>
          {checkout.depositCredit > 0 ? (
            <Row label={t('checkout.depositCredit')}>
              <Money fils={-checkout.depositCredit} tone="navy" />
            </Row>
          ) : null}
          <Row label={t('checkout.payable')} strong>
            <Money fils={checkout.payable} />
          </Row>
        </View>
      </Card>

      <Section title={t('delivery.title')}>
        <DeliveryForm value={draft} onChange={setDraft} errors={errors} saved={saved} />
        <Chip
          label={t('delivery.saveAddress')}
          selected={saveAddress}
          onPress={() => setSaveAddress((v) => !v)}
        />
      </Section>

      {demo ? (
        <Section title={t('pay.demoTitle')}>
          <Banner tone="warn" message={t('pay.demoNote')} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {demo.scenarios.map((s) => (
              <Chip
                key={s.id}
                label={t(`pay.demo.${s.id}` as never)}
                selected={scenario === s.id}
                onPress={() => {
                  demo.select(s.id);
                  setScenario(s.id);
                }}
              />
            ))}
          </View>
        </Section>
      ) : null}

      {phase.kind === 'cancelled' ? <Banner tone="info" message={t('pay.cancelled')} /> : null}
      {phase.kind === 'not-configured' ? (
        <Banner tone="warn" message={t('pay.notConfigured')} />
      ) : null}
      {phase.kind === 'bank' ? <Banner tone="info" message={t('pay.waitingBank')} /> : null}
      {phase.kind === 'bank-timeout' ? <Banner tone="warn" message={t('pay.bankTimeout')} /> : null}
      {phase.kind === 'in-progress' ? <Banner tone="info" message={t('pay.inProgress')} /> : null}
      {phase.kind === 'changed' ? (
        <Banner
          tone="warn"
          title={t('pay.changedTitle')}
          message={t('pay.changedBody')}
          action={{
            label: t('pay.review'),
            onPress: () => router.replace(`/checkout/${checkout.id}` as never),
          }}
        />
      ) : null}

      {pay.isError && error?.kind !== 'in-progress' && error?.kind !== 'checkout-changed' ? (
        <View style={{ gap: space[2] }}>
          <ErrorView
            error={pay.error}
            {...(error?.kind === 'retry'
              ? { onRetry: () => pay.mutateAsync().catch(() => undefined) }
              : {})}
          />
          {error?.kind === 'retry' ? (
            <Text variant="caption" tone="secondary">
              {t('pay.safeRetry')}
            </Text>
          ) : null}
          {error?.kind === 'declined' ? (
            <Text variant="caption" tone="secondary">
              {t('pay.tryAnother')}
            </Text>
          ) : null}
        </View>
      ) : null}

      <Button
        title={t('pay.action')}
        loading={pay.isPending}
        onPress={() => pay.mutateAsync().catch(() => undefined)}
      />
      <Text variant="caption" tone="secondary">
        {t('pay.secure')}
      </Text>
    </View>
  );
}
