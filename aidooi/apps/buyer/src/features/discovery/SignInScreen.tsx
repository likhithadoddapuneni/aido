import { useEffect, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Banner,
  Button,
  Chip,
  ErrorView,
  OtpField,
  PhoneField,
  RoomScene,
  Screen,
  Text,
  useTheme,
} from '@aidooi/ui-native';
import { PageHeader } from '../../components/index.tsx';
import { useTx } from '../../i18n/useTx.ts';
import { useAppState, useServices } from '../../providers/AppProviders.tsx';

/** The version of the terms a new customer accepts here; recorded server-side as consent. */
export const POLICY_VERSION = '2026-01';
export const RESEND_SECONDS = 30;
const OAUTH_CONFIGURED = process.env['EXPO_PUBLIC_OAUTH_ENABLED'] === 'true';

/**
 * Phone one-time code. Signing in upgrades the guest session on the server, so the buyer's projects come
 * with them, and the step they were heading for (saved before they got here) is resumed — nothing restarts.
 */
export function SignInScreen() {
  const t = useTx();
  const router = useRouter();
  const { space, radius, color } = useTheme();
  const width = useWindowDimensions().width - space[3] * 2;
  const { services, store, pending } = useServices();
  const { signInWithTokens } = useAppState();
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [e164, setE164] = useState<string | null>(null);
  const [terms, setTerms] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (seconds <= 0) return;
    const id = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [seconds]);

  const send = async () => {
    setSubmitted(true);
    setError(null);
    if (!e164 || !terms) return;
    try {
      await services.requestOtp(e164);
      setStage('code');
      setCode('');
      setSeconds(RESEND_SECONDS);
    } catch (e) {
      setError(e);
    }
  };

  const verify = async (value: string) => {
    if (!e164) return;
    setError(null);
    try {
      const session = await store.read();
      const result = await services.verifyOtp({
        phone: e164,
        code: value,
        ...(session?.kind === 'guest' ? { guestToken: session.guestToken } : {}),
        policyVersion: POLICY_VERSION,
      });
      await signInWithTokens(result);
      const next = await pending.consume();
      router.replace((next ?? '/(tabs)/projects') as never);
    } catch (e) {
      setCode('');
      setError(e);
    }
  };

  return (
    <Screen>
      <PageHeader
        title={t('signIn.title')}
        subtitle={t(stage === 'phone' ? 'signIn.phoneHint' : 'signIn.codeHint')}
        onBack={() => (stage === 'code' ? setStage('phone') : router.back())}
      />
      <View
        style={{
          height: Math.round(width * 0.38),
          borderRadius: radius.xl,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: color.borderSoft,
        }}
      >
        <RoomScene kind="bedroom" width={width} height={Math.round(width * 0.38)} />
      </View>
      {stage === 'phone' ? (
        <View style={{ gap: space[3] }}>
          <PhoneField
            value={phone}
            onChange={(raw, e) => (setPhone(raw), setE164(e))}
            showError={submitted}
          />
          <Chip
            label={t('signIn.terms')}
            icon={terms ? 'check' : undefined}
            selected={terms}
            onPress={() => setTerms((v) => !v)}
          />
          {submitted && !terms ? (
            <Text variant="caption" tone="error" accessibilityLiveRegion="polite">
              {t('signIn.termsRequired')}
            </Text>
          ) : null}
          <Button title={t('signIn.send')} onPress={send} />
          <View style={{ gap: space[2] }}>
            <Button
              variant="secondary"
              title={t('signIn.apple')}
              disabled={!OAUTH_CONFIGURED}
              onPress={() => undefined}
            />
            <Button
              variant="secondary"
              title={t('signIn.google')}
              disabled={!OAUTH_CONFIGURED}
              onPress={() => undefined}
            />
            {!OAUTH_CONFIGURED ? <Banner tone="info" message={t('signIn.oauthOff')} /> : null}
          </View>
        </View>
      ) : (
        <View style={{ gap: space[3] }}>
          <Text tone="secondary">{t('signIn.sentTo', { phone: e164 ?? phone })}</Text>
          <OtpField
            value={code}
            onChange={setCode}
            onComplete={verify}
            error={error !== null}
            autoFocus
          />
          <Button
            variant="ghost"
            title={seconds > 0 ? t('signIn.resendIn', { seconds }) : t('signIn.resend')}
            disabled={seconds > 0}
            onPress={send}
          />
        </View>
      )}
      {error !== null ? <ErrorView error={error} /> : null}
    </Screen>
  );
}
