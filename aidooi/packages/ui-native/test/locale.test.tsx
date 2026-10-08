import { screen } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';
import {
  LocaleProvider,
  applyLocale,
  useLocale,
  useT,
  type DirectionManager,
} from '../src/index.ts';
import { nativeFamily } from '../src/internal/fonts.ts';
import { renderApp } from './helpers.tsx';

const CATALOGUE = {
  en: { hello: 'Hello {name}', onlyEnglish: 'Only English' },
  ar: { hello: 'مرحبا {name}' },
} as const;

function Probe() {
  const t = useT(CATALOGUE as never as Record<'en' | 'ar', Record<string, string>>);
  const { locale, rtl } = useLocale();
  return (
    <RNText testID="out">
      {locale}|{String(rtl)}|{t('hello', { name: 'Aisha' })}|{t('onlyEnglish')}|{t('missing')}
    </RNText>
  );
}

describe('locale and translation', () => {
  it('translates with parameters, falls back to English, then to the key', async () => {
    await renderApp(<Probe />);
    expect(screen.getByTestId('out').props.children.join('')).toBe(
      'en|false|Hello Aisha|Only English|missing',
    );
  });

  it('Arabic is right-to-left and falls back to English for a missing string', async () => {
    await renderApp(<Probe />, { locale: 'ar' });
    expect(screen.getByTestId('out').props.children.join('')).toBe(
      'ar|true|مرحبا Aisha|Only English|missing',
    );
  });

  it('the provider changes language when its prop changes', async () => {
    const { rerender } = await renderApp(<Probe />);
    await rerender(
      <LocaleProvider locale="ar">
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getAllByTestId('out').at(-1)!.props.children[0]).toBe('ar');
  });
});

describe('applyLocale', () => {
  const manager = (isRTL: boolean): DirectionManager & { calls: unknown[][] } => {
    const calls: unknown[][] = [];
    return {
      isRTL,
      calls,
      allowRTL: (v) => void calls.push(['allow', v]),
      forceRTL: (v) => void calls.push(['force', v]),
    };
  };

  it('asks for a reload exactly when the native direction differs from the language', () => {
    expect(applyLocale('ar', manager(false)).needsReload).toBe(true);
    expect(applyLocale('ar', manager(true)).needsReload).toBe(false);
    expect(applyLocale('en', manager(true)).needsReload).toBe(true);
    expect(applyLocale('en', manager(false)).needsReload).toBe(false);
  });

  it('on the web it sets the document direction and language at once, with no reload', () => {
    const root = { dir: '', lang: '' };
    (globalThis as { document?: unknown }).document = { documentElement: root };
    try {
      expect(applyLocale('ar', manager(false)).needsReload).toBe(false);
      expect(root).toEqual({ dir: 'rtl', lang: 'ar' });
      applyLocale('en', manager(true));
      expect(root).toEqual({ dir: 'ltr', lang: 'en' });
    } finally {
      delete (globalThis as { document?: unknown }).document;
    }
  });

  it('tells the native layer what to do', () => {
    const m = manager(false);
    applyLocale('ar', m);
    expect(m.calls).toEqual([
      ['allow', true],
      ['force', true],
    ]);
  });
});

describe('fonts', () => {
  it('native needs a single family name from the token stack', () => {
    expect(nativeFamily('"Cormorant Garamond", "Playfair Display", Georgia, serif')).toBe(
      'Cormorant Garamond',
    );
    expect(nativeFamily('"Inter", -apple-system, sans-serif')).toBe('Inter');
    expect(nativeFamily('Tahoma, sans-serif')).toBe('Tahoma');
  });
});
