import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { loadAsync } from 'expo-font';
import { AppProviders, useAppState } from '../src/providers/AppProviders.tsx';
import { BrandSplash } from '../src/components/index.tsx';
import { FONT_FACES } from '../src/theme/fonts.ts';

/**
 * Typefaces load once. A font that fails to load must not block the app: the system face is used and
 * the screen still renders, so the promise always resolves to "done".
 */
function useTypefaces(): boolean {
  const [done, setDone] = useState(false);
  useEffect(() => {
    let live = true;
    void loadAsync(FONT_FACES)
      .catch(() => undefined)
      .then(() => live && setDone(true));
    return () => {
      live = false;
    };
  }, []);
  return done;
}

/**
 * Nothing renders until the stored session, language, onboarding flag and typefaces are known: no flash
 * of the wrong screen and no flash of the wrong font.
 */
function Shell() {
  const { ready } = useAppState();
  const fontsDone = useTypefaces();
  if (!ready || !fontsDone) return <BrandSplash />;
  return <Stack screenOptions={{ headerShown: false, animation: 'fade_from_bottom' }} />;
}

export default function RootLayout() {
  return (
    <AppProviders>
      <Shell />
    </AppProviders>
  );
}
