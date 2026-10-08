import { useEffect } from 'react';

/** The slice of `expo-brightness` this app uses, so tests can substitute it. */
export interface BrightnessModule {
  getBrightnessAsync(): Promise<number>;
  setBrightnessAsync(value: number): Promise<void>;
}

const load = async (): Promise<BrightnessModule | null> => {
  try {
    return (await import('expo-brightness')) as BrightnessModule;
  } catch {
    return null;
  }
};

/**
 * Turn the screen up while a QR code is on it — glare makes scanners fail — and put it back afterwards.
 * Best effort: no brightness API (web, a denied permission) simply means no change.
 */
export function useBrightnessBoost(enabled: boolean, module?: BrightnessModule | null): void {
  useEffect(() => {
    if (!enabled) return;
    let restore: (() => Promise<void>) | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const b = module === undefined ? await load() : module;
        if (!b) return;
        const before = await b.getBrightnessAsync();
        if (cancelled) return;
        await b.setBrightnessAsync(1);
        restore = () => b.setBrightnessAsync(before);
        if (cancelled) await restore();
      } catch {
        /* unsupported or denied: leave the screen as it is */
      }
    })();
    return () => {
      cancelled = true;
      void restore?.().catch(() => undefined);
    };
  }, [enabled, module]);
}
