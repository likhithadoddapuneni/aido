import { useState } from 'react';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  Money,
  Screen,
  Text,
  useLocale,
  useT,
  useTheme,
  useToast,
} from '@aidooi/ui-native';
import { catalogue } from '../i18n/index.ts';
import { canCancel, nextStep, type LineState } from '../data/seller.ts';
import { useOnline } from '../net/online.ts';
import { useAuth } from '../session/auth.tsx';
import { ConfirmSheet } from '../ui/ConfirmSheet.tsx';
import { messageFor } from '../ui/errors.ts';
import { OfflineBanner } from '../ui/OfflineBanner.tsx';
import { QueryState } from '../ui/Query.tsx';
import { useAdvance, useLines } from './useLines.ts';
import { useProof } from './useProof.ts';

const stateLabel = (s: LineState): string => s;

/** One order line: where it goes, its next step, and — for delivery — the photo that proves it. */
export function LineScreen({ id }: { id: string }) {
  const t = useT(catalogue);
  const { locale } = useLocale();
  const { space } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const online = useOnline();
  const { data, caps } = useAuth();
  const lines = useLines('active');
  const advance = useAdvance();
  const proof = useProof(id, data);
  const [confirming, setConfirming] = useState<'next' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');

  const line = lines.data?.pages.flatMap((p) => p.items).find((l) => l.id === id);
  const step = line ? nextStep(line.state) : null;
  const needsProof = step?.needsProof === true;
  const proofReady = proof.state.phase === 'ready';

  const run = async (to: NonNullable<typeof step>['to'] | 'Cancelled') => {
    try {
      const r = await advance.mutateAsync({
        id,
        to,
        ...(to === 'Delivered' && proof.state.phase === 'ready'
          ? { proofPhotoKey: proof.state.key }
          : {}),
        ...(to === 'Cancelled' ? { reason: reason.trim() } : {}),
      });
      setConfirming(null);
      toast.show({ message: r.changed ? t('orders.moved') : t('orders.unchanged'), tone: 'ok' });
      if (to === 'Cancelled' || to === 'Delivered') router.back();
    } catch (e) {
      setConfirming(null);
      toast.show({ message: messageFor(e, locale), tone: 'error' });
    }
  };

  return (
    <Screen>
      <OfflineBanner />
      <QueryState loading={lines.isPending} error={lines.error} onRetry={() => lines.refetch()}>
        {!line ? (
          <EmptyState
            title={t('tasks.notFound')}
            action={{ label: t('common.close'), onPress: () => router.back() }}
          />
        ) : (
          <View style={{ gap: space[3] }}>
            <Text variant="h1">{line.productName}</Text>
            <Badge label={stateLabel(line.state)} tone="info" />
            <Text>
              {t('orders.qty', { n: line.quantity })} · <Money fils={line.grossLineFils} />
            </Text>
            {line.openIssues > 0 ? (
              <Banner
                tone="warn"
                message={t('orders.issues', { n: line.openIssues })}
                action={{ label: t('issues.title'), onPress: () => router.push('/issues') }}
              />
            ) : null}
            {line.delivery ? (
              <Card>
                <Text variant="label">{t('orders.deliverTo')}</Text>
                <Text onSurface>{line.delivery.recipientName}</Text>
                <Text onSurface>
                  {[
                    line.delivery.line1,
                    line.delivery.line2,
                    line.delivery.area,
                    line.delivery.emirate,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </Text>
                <Text onSurface tone="secondary">
                  {line.delivery.phone}
                </Text>
                {line.delivery.instructions ? (
                  <Text onSurface tone="secondary">
                    {line.delivery.instructions}
                  </Text>
                ) : null}
              </Card>
            ) : null}

            {needsProof ? (
              <Card>
                <Text variant="h3">{t('orders.proof.title')}</Text>
                <Text onSurface tone="secondary">
                  {t('orders.proof.required')}
                </Text>
                {proof.state.phase === 'denied' ? (
                  <Text tone="error">{t('orders.proof.denied')}</Text>
                ) : null}
                {proof.state.phase === 'failed' ? (
                  <Text tone="error">{t('orders.proof.failed')}</Text>
                ) : null}
                {proof.state.phase === 'uploading' ? (
                  <Text>{t('orders.proof.uploading')}</Text>
                ) : null}
                <Button
                  title={proofReady ? t('orders.proof.retake') : t('orders.proof.take')}
                  variant="secondary"
                  disabled={!online || proof.state.phase === 'uploading'}
                  onPress={proof.capture}
                />
              </Card>
            ) : null}

            {step && caps.advanceOrders ? (
              <Button
                title={t(`orders.advance.${step.to}` as 'orders.advance.Preparing')}
                disabled={!online || (needsProof && !proofReady)}
                onPress={() => setConfirming('next')}
              />
            ) : null}
            {canCancel(line.state) ? (
              <Button
                title={t('orders.cancel')}
                variant="destructive"
                disabled={!online}
                onPress={() => setConfirming('cancel')}
              />
            ) : null}
          </View>
        )}
      </QueryState>

      {line && step ? (
        <ConfirmSheet
          visible={confirming === 'next'}
          title={t('orders.confirm.title', { state: step.to })}
          body={t('orders.confirm.body')}
          confirmLabel={t('common.confirm')}
          disabled={!online}
          onConfirm={() => run(step.to)}
          onClose={() => setConfirming(null)}
        />
      ) : null}
      <ConfirmSheet
        visible={confirming === 'cancel'}
        title={t('orders.cancel.title')}
        body={t('orders.cancel.body')}
        confirmLabel={t('orders.cancel')}
        destructive
        disabled={!online || reason.trim().length < 3}
        onConfirm={() => run('Cancelled')}
        onClose={() => setConfirming(null)}
      >
        <Field label={t('orders.cancel.reason')} value={reason} onChangeText={setReason} />
      </ConfirmSheet>
    </Screen>
  );
}
