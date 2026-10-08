import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { AppProviders, defaultAuthDeps } from '../src/shell/providers.tsx';
import { deviceLocale } from '../src/shell/locale-store.ts';
import { routeForNotification, taskIdFromUrl } from '../src/notifications/push.ts';
import { useAuth } from '../src/session/auth.tsx';

// Show an alert even when the app is open: a buyer may be waiting.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const authDeps = defaultAuthDeps();

export default function RootLayout() {
  return (
    <AppProviders auth={authDeps} persistence={deviceLocale}>
      <Gate />
    </AppProviders>
  );
}

/**
 * Sends signed-out users to sign-in and signed-in users into the app, and opens the right task when a
 * notification (or an `aidooiseller://task/<id>` link) is tapped — after sign-in if need be.
 */
function Gate() {
  const { status } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const inAuth = segments[0] === '(auth)';

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'signedOut' && !inAuth) router.replace('/sign-in');
    if (status === 'signedIn' && inAuth) router.replace('/');
  }, [status, inAuth, router]);

  useEffect(() => {
    if (status !== 'signedIn') return;
    const open = (target: string | null) => target && router.push(target as never);
    const sub = Notifications.addNotificationResponseReceivedListener((r) =>
      open(routeForNotification(r.notification.request.content.data)),
    );
    void Linking.getInitialURL().then((url) => {
      const id = taskIdFromUrl(url);
      if (id) open(`/task/${id}`);
    });
    return () => sub.remove();
  }, [status, router]);

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
