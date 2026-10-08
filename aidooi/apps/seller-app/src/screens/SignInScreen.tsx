import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Button, Field, OtpField, Screen, Text, useLocale, useT } from '@aidooi/ui-native';
import { ApiProblem } from '@aidooi/api-client';
import { catalogue } from '../i18n/index.ts';
import { clearPending, setPending } from '../session/pending.ts';
import { useAuth } from '../session/auth.tsx';
import { messageFor } from '../ui/errors.ts';
import { OfflineBanner } from '../ui/OfflineBanner.tsx';
import { useOnline } from '../net/online.ts';

/** Staff sign-in: email, password and the 6-digit authenticator code. Sellers are invite-only (ADR-003). */
export function SignInScreen() {
  const t = useT(catalogue);
  const { locale } = useLocale();
  const router = useRouter();
  const { data, completeSignIn } = useAuth();
  const online = useOnline();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();

  const submit = async (otp = code) => {
    setError(undefined);
    try {
      const s = await data.login({ email: email.trim().toLowerCase(), password, totpCode: otp });
      if (s.staff.kind !== 'seller') {
        setError(messageFor(new ApiProblem({ status: 403, code: 'forbidden' }), locale));
        return;
      }
      clearPending();
      await completeSignIn(s, s.staff, email.trim().toLowerCase());
      router.replace('/');
    } catch (e) {
      if (e instanceof ApiProblem && e.code === 'mfa_enrolment_required') {
        setPending({ email: email.trim().toLowerCase(), password });
        router.push('/enroll');
        return;
      }
      setError(messageFor(e, locale));
      setCode('');
    }
  };

  return (
    <Screen>
      <Text variant="display">AiDOOi</Text>
      <Text variant="h2">{t('auth.title')}</Text>
      <Text tone="secondary">{t('auth.subtitle')}</Text>
      <OfflineBanner />
      <Field
        label={t('auth.email')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <Field
        label={t('auth.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
      />
      <Text variant="label">{t('auth.code')}</Text>
      <OtpField
        value={code}
        onChange={setCode}
        error={error !== undefined}
        onComplete={(c) => {
          if (email && password && online) void submit(c);
        }}
      />
      <Text variant="caption" tone="secondary">
        {t('auth.codeHint')}
      </Text>
      {error ? (
        <Text tone="error" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <Button
        title={t('auth.signIn')}
        disabled={!online || !email || !password || code.length !== 6}
        onPress={() => submit()}
      />
      <Button
        title={t('auth.haveInvite')}
        variant="ghost"
        onPress={() => router.push('/accept-invite')}
      />
    </Screen>
  );
}
