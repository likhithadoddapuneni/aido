import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Button, Field, Screen, Text, useLocale, useT } from '@aidooi/ui-native';
import { catalogue } from '../i18n/index.ts';
import { setPending } from '../session/pending.ts';
import { useAuth } from '../session/auth.tsx';
import { useOnline } from '../net/online.ts';
import { messageFor } from '../ui/errors.ts';
import { OfflineBanner } from '../ui/OfflineBanner.tsx';

/** First run: the invitation code and a new password, then straight on to authenticator setup. */
export function AcceptInviteScreen() {
  const t = useT(catalogue);
  const { locale } = useLocale();
  const router = useRouter();
  const { data } = useAuth();
  const online = useOnline();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();

  const submit = async () => {
    setError(undefined);
    try {
      const { email } = await data.acceptInvite({ token: token.trim(), password });
      setPending({ email, password });
      router.replace('/enroll');
    } catch (e) {
      setError(messageFor(e, locale));
    }
  };

  return (
    <Screen>
      <Text variant="h1">{t('auth.invite.title')}</Text>
      <OfflineBanner />
      <Field
        label={t('auth.invite.token')}
        value={token}
        onChangeText={setToken}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Field
        label={t('auth.invite.password')}
        hint={t('auth.invite.passwordHint')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        error={error}
      />
      <Button
        title={t('auth.invite.continue')}
        disabled={!online || token.trim().length < 20 || password.length < 12}
        onPress={submit}
      />
      <Button title={t('auth.back')} variant="ghost" onPress={() => router.replace('/sign-in')} />
    </Screen>
  );
}
