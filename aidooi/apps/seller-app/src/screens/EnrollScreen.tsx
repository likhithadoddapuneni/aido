import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Button, Card, OtpField, Screen, Text, useLocale, useT } from '@aidooi/ui-native';
import { catalogue } from '../i18n/index.ts';
import { clearPending, takePending } from '../session/pending.ts';
import { useAuth } from '../session/auth.tsx';
import { useOnline } from '../net/online.ts';
import { messageFor } from '../ui/errors.ts';

/**
 * Two-step verification is mandatory for staff (ADR-035). The secret is shown once, as selectable text
 * (and the otpauth link the authenticator app can open), then the first code proves it was added.
 */
export function EnrollScreen() {
  const t = useT(catalogue);
  const { locale } = useLocale();
  const router = useRouter();
  const { data, completeSignIn } = useAuth();
  const online = useOnline();
  const [creds] = useState(takePending);
  const [secret, setSecret] = useState<{ seed: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();

  // Arrived without credentials (the app restarted mid-setup): start again from sign-in.
  useEffect(() => {
    if (!creds) router.replace('/sign-in');
  }, [creds, router]);
  if (!creds) return null;

  const start = async () => {
    setError(undefined);
    try {
      const r = await data.mfaEnroll(creds);
      setSecret({ seed: r.seed, uri: r.otpauthUri });
    } catch (e) {
      setError(messageFor(e, locale));
    }
  };

  const finish = async (otp = code) => {
    setError(undefined);
    try {
      const s = await data.mfaVerify({ ...creds, totpCode: otp });
      if (s.staff.kind !== 'seller') throw new Error('not a seller');
      clearPending();
      await completeSignIn(s, s.staff, creds.email);
      router.replace('/');
    } catch (e) {
      setError(messageFor(e, locale));
      setCode('');
    }
  };

  return (
    <Screen>
      <Text variant="h1">{t('auth.enroll.title')}</Text>
      <Text>{t('auth.enroll.intro')}</Text>
      {secret ? (
        <>
          <Card>
            <Text variant="label">{t('auth.enroll.secret')}</Text>
            <Text selectable variant="h3" testID="mfa-secret">
              {secret.seed}
            </Text>
            <Text variant="caption" tone="secondary" onSurface>
              {t('auth.enroll.copyHint')}
            </Text>
          </Card>
          <Text variant="label">{t('auth.code')}</Text>
          <OtpField
            value={code}
            onChange={setCode}
            error={error !== undefined}
            onComplete={(c) => void finish(c)}
          />
          {error ? (
            <Text tone="error" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Button
            title={t('auth.enroll.verify')}
            disabled={!online || code.length !== 6}
            onPress={() => finish()}
          />
        </>
      ) : (
        <>
          {error ? <Text tone="error">{error}</Text> : null}
          <Button title={t('auth.enroll.start')} disabled={!online} onPress={start} />
        </>
      )}
    </Screen>
  );
}
