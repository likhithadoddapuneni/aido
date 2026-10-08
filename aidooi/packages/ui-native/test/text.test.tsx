import { screen } from '@testing-library/react-native';
import { color, font } from '@aidooi/ui-tokens';
import { Text } from '../src/index.ts';
import { flat, renderApp } from './helpers.tsx';

const styleOf = (id: string) => flat(screen.getByTestId(id).props.style);

describe('Text', () => {
  it('headings are announced as headers; body text is not', async () => {
    await renderApp(
      <>
        <Text variant="h1" testID="h1">
          Title
        </Text>
        <Text testID="body">Body</Text>
      </>,
    );
    expect(screen.getByTestId('h1').props.accessibilityRole).toBe('header');
    expect(screen.getByTestId('body').props.accessibilityRole).toBeUndefined();
  });

  it('only display headings use the serif; functional text and PRICES are always sans', async () => {
    await renderApp(
      <>
        <Text variant="display" testID="display">
          A
        </Text>
        <Text variant="h2" testID="h2">
          B
        </Text>
        <Text variant="price" testID="price">
          AED 100
        </Text>
      </>,
    );
    expect(styleOf('display').fontFamily).toBe('CormorantGaramond_600SemiBold');
    expect(styleOf('h2').fontFamily).toBe('Inter_600SemiBold');
    expect(styleOf('price').fontFamily).toBe('Inter_700Bold');
    expect(font.serif).toContain('Cormorant Garamond');
  });

  it('prices use tabular figures so columns of amounts line up', async () => {
    await renderApp(
      <Text variant="price" testID="p">
        1,234
      </Text>,
    );
    expect(styleOf('p').fontVariant).toEqual(['tabular-nums']);
  });

  it('Arabic switches to the Arabic faces and right-to-left writing direction', async () => {
    await renderApp(
      <>
        <Text variant="display" testID="d">
          مرحبا
        </Text>
        <Text testID="b">مرحبا</Text>
      </>,
      { locale: 'ar' },
    );
    expect(styleOf('d').fontFamily).toBe('IBMPlexSansArabic_600SemiBold');
    expect(styleOf('b').fontFamily).toBe('IBMPlexSansArabic_400Regular');
    expect(styleOf('b').writingDirection).toBe('rtl');
  });

  it('English is left-to-right', async () => {
    await renderApp(<Text testID="b">Hello</Text>);
    expect(styleOf('b').writingDirection).toBe('ltr');
  });

  it('secondary text uses the AA-safe grey on cards, the standard grey elsewhere (ADR-048)', async () => {
    await renderApp(
      <>
        <Text tone="secondary" testID="plain">
          a
        </Text>
        <Text tone="secondary" onSurface testID="card">
          b
        </Text>
      </>,
    );
    expect(styleOf('plain').color).toBe(color.text2);
    expect(styleOf('card').color).toBe(color.text2OnSurface);
  });

  it('allows OS font scaling, but only up to a ceiling so layouts survive the largest sizes', async () => {
    await renderApp(<Text testID="b">x</Text>);
    expect(screen.getByTestId('b').props.allowFontScaling).toBe(true);
    expect(screen.getByTestId('b').props.maxFontSizeMultiplier).toBeGreaterThan(1);
    expect(screen.getByTestId('b').props.maxFontSizeMultiplier).toBeLessThanOrEqual(2);
  });
});
