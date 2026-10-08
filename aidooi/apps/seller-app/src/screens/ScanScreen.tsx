/* eslint-disable no-restricted-globals -- formats instants at the display edge; holds no business rules */
import { useState } from 'react';
import { Linking, Platform, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  Screen,
  Text,
  useLocale,
  useT,
  useTheme,
  useToast,
} from '@aidooi/ui-native';
import { catalogue } from '../i18n/index.ts';
import type { ScanView } from '../domain/scan.ts';
import { useOnline } from '../net/online.ts';
import { useAuth } from '../session/auth.tsx';
import { messageFor } from '../ui/errors.ts';
import { OfflineBanner } from '../ui/OfflineBanner.tsx';
import { useScanFlow } from './scanFlow.ts';

const PROBLEM_KEY = {
  invalid: 'scan.invalid',
  expired: 'scan.expired',
  not_yet: 'scan.notYet',
  not_ours: 'scan.notOurs',
  closed: 'scan.closed',
  error: 'scan.error',
} as const;

/** Check a visitor in by their QR pass; type the code if the camera is off or unavailable. */
export function ScanScreen() {
  const t = useT(catalogue);
  const { locale } = useLocale();
  const { space } = useTheme();
  const toast = useToast();
  const online = useOnline();
  const { data } = useAuth();
  const flow = useScanFlow(data);
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState('');
  const cameraUsable = Platform.OS !== 'web';

  const shown = flow.state.phase === 'shown' ? flow.state : null;

  return (
    <Screen>
      <Text variant="h1">{t('scan.title')}</Text>
      <OfflineBanner />
      {shown ? (
        <ScanResult
          view={shown.view}
          outcome={shown.outcome}
          disabled={!online}
          onOutcome={async (o) => {
            try {
              await flow.record(o);
              toast.show({ message: t('scan.outcomeSaved'), tone: 'ok' });
            } catch (e) {
              toast.show({ message: messageFor(e, locale), tone: 'error' });
            }
          }}
          onNext={flow.reset}
        />
      ) : (
        <View style={{ gap: space[3] }}>
          {cameraUsable ? (
            permission?.granted ? (
              <View style={{ height: 280, borderRadius: space[3], overflow: 'hidden' }}>
                <CameraView
                  style={{ flex: 1 }}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={online ? (r) => void flow.submit(r.data) : undefined}
                  accessibilityLabel={t('scan.hint')}
                />
              </View>
            ) : (
              <EmptyState
                title={t('scan.permission.title')}
                message={t('scan.permission.message')}
                action={
                  permission && !permission.canAskAgain
                    ? {
                        label: t('scan.permission.settings'),
                        onPress: () => void Linking.openSettings(),
                      }
                    : { label: t('scan.permission.allow'), onPress: () => void requestPermission() }
                }
              />
            )
          ) : null}
          <Text tone="secondary">{t('scan.hint')}</Text>
          <Field
            label={t('scan.manual')}
            hint={t('scan.manual.hint')}
            value={manual}
            onChangeText={setManual}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Button
            title={t('scan.manual.submit')}
            disabled={!online || manual.trim().length < 10 || flow.state.phase === 'busy'}
            loading={flow.state.phase === 'busy'}
            onPress={() => flow.submit(manual)}
          />
        </View>
      )}
    </Screen>
  );
}

function ScanResult({
  view,
  outcome,
  disabled,
  onOutcome,
  onNext,
}: {
  view: ScanView;
  outcome: 'Completed' | 'No-show' | null;
  disabled: boolean;
  onOutcome: (o: 'Completed' | 'No-show') => void | Promise<unknown>;
  onNext: () => void;
}) {
  const t = useT(catalogue);
  const { space } = useTheme();
  if (view.kind !== 'checked_in' && view.kind !== 'already') {
    return (
      <View style={{ gap: space[3] }}>
        <Banner tone="error" message={t(PROBLEM_KEY[view.kind])} />
        <Button title={t('scan.next')} onPress={onNext} />
      </View>
    );
  }
  const r = view.result;
  const time = new Date(r.checkedInAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <View style={{ gap: space[3] }}>
      <Badge
        label={view.kind === 'already' ? t('scan.already') : t('scan.checkedIn')}
        tone={view.kind === 'already' ? 'info' : 'ok'}
      />
      {view.kind === 'already' ? (
        <Banner tone="info" message={t('scan.alreadyMessage', { time })} />
      ) : null}
      <Text variant="h2">
        {r.buyerName ? t('scan.buyer', { name: r.buyerName }) : t('scan.anonymous')}
      </Text>
      <Text variant="label">{t('scan.viewing')}</Text>
      {r.products.map((p, i) => (
        <Card key={`${p.name}-${i}`}>
          <Text>
            {p.name} ×{p.quantity}
          </Text>
        </Card>
      ))}
      {outcome ? (
        <Badge label={outcome === 'Completed' ? t('scan.visited') : t('scan.noShow')} tone="ok" />
      ) : (
        <>
          <Button
            title={t('scan.visited')}
            disabled={disabled}
            onPress={() => onOutcome('Completed')}
          />
          <Button
            title={t('scan.noShow')}
            variant="secondary"
            disabled={disabled}
            onPress={() => onOutcome('No-show')}
          />
        </>
      )}
      <Button title={t('scan.next')} variant="ghost" onPress={onNext} />
    </View>
  );
}
