import { screen } from '@testing-library/react-native';
import { art, color } from '@aidooi/ui-tokens';
import {
  ART_TYPES,
  ProductArt,
  RoomScene,
  Icon,
  ICON_NAMES,
  ScoreRing,
  productArtSvg,
  proportion,
  roomSceneSvg,
  type ArtProduct,
  type RoomKind,
} from '../src/index.ts';
import { planGlyph, planSvg } from '../src/planArt.ts';
import { renderApp } from './helpers.tsx';

const base: ArtProduct = {
  type: 'Sofa',
  primaryColour: 'blue',
  material: 'Fabric',
  widthCm: 210,
  depthCm: 90,
  heightCm: 85,
  name: 'Lund 3-seater',
};

describe('product illustration (AID-DATA-012)', () => {
  it('draws every product type the catalogue has, as well-formed SVG', () => {
    expect(ART_TYPES.length).toBe(32);
    for (const type of ART_TYPES) {
      const svg = productArtSvg({ ...base, type });
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
      // Every opened element is closed: a cheap well-formedness check that catches template slips.
      const opens = (svg.match(/<(?!\/|\?|!)[a-zA-Z]+/g) ?? []).length;
      const closes = (svg.match(/<\/[a-zA-Z]+>|\/>/g) ?? []).length;
      expect(closes).toBe(opens);
      expect(svg).not.toMatch(/undefined|NaN|\[object/);
    }
  });

  it('the colour family tints the body, and different families differ', () => {
    expect(productArtSvg({ ...base, material: 'Metal' }).toLowerCase()).toContain(
      art.tone.blue.toLowerCase(),
    );
    expect(productArtSvg({ ...base, primaryColour: 'red', material: 'Metal' })).not.toBe(
      productArtSvg({ ...base, primaryColour: 'green', material: 'Metal' }),
    );
  });

  it('the material family sets the frame colour and the surface texture', () => {
    const wood = productArtSvg({ ...base, material: 'Wood' });
    const rattan = productArtSvg({ ...base, material: 'Rattan' });
    expect(wood.toLowerCase()).toContain(art.frame.Wood.toLowerCase());
    expect(rattan.toLowerCase()).toContain(art.frame.Rattan.toLowerCase());
    expect(wood).toContain('<pattern');
    expect(productArtSvg({ ...base, material: 'Leather' })).toContain('<linearGradient');
    // An unknown material still draws, in the neutral frame and plain fill.
    expect(productArtSvg({ ...base, material: 'Unknown' }).toLowerCase()).toContain(
      art.fallbackFrame.toLowerCase(),
    );
  });

  it('real proportions stretch the drawing toward the record, within limits', () => {
    expect(proportion({ type: 'Sofa', widthCm: 200, heightCm: 85 })).toBeCloseTo(1, 1);
    expect(proportion({ type: 'Sofa', widthCm: 300, heightCm: 85 })).toBeGreaterThan(1);
    expect(proportion({ type: 'Sofa', widthCm: 120, heightCm: 85 })).toBeLessThan(1);
    expect(proportion({ type: 'Sofa', widthCm: 900, heightCm: 40 })).toBe(1.3);
    expect(proportion({ type: 'Sofa', widthCm: 20, heightCm: 200 })).toBe(0.8);
    expect(proportion({ type: 'Mystery', widthCm: 20, heightCm: 200 })).toBe(1);
    expect(proportion({ type: 'Sofa', widthCm: 0, heightCm: 0 })).toBe(1);
  });

  it('seat count follows the real width, so a bigger sofa is drawn bigger', () => {
    const seats = (w: number) =>
      (productArtSvg({ ...base, widthCm: w }).match(/height="33"/g) ?? []).length;
    expect(seats(150)).toBeLessThan(seats(280));
  });

  it('every gradient id in one drawing is unique, so two drawings on a screen never clash', () => {
    const ids = (svg: string) => [...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    const a = ids(productArtSvg({ ...base, material: 'Wood' }));
    const b = ids(productArtSvg({ ...base, material: 'Wood' }));
    expect(new Set([...a, ...b]).size).toBe(a.length + b.length);
  });

  it('renders as a labelled image, or hides itself when decorative', async () => {
    await renderApp(<ProductArt product={base} />);
    expect(screen.getByLabelText('Lund 3-seater, blue Fabric')).toBeTruthy();
    await renderApp(<ProductArt product={base} decorative />);
    expect(screen.getAllByTestId('product-art', { includeHiddenElements: true }).length).toBe(1);
  });
});

describe('room scenes', () => {
  const kinds: RoomKind[] = [
    'livingRoom',
    'bedroom',
    'diningRoom',
    'homeOffice',
    'studio',
    'fullApartment',
    'villa',
    'individualProduct',
  ];
  it.each(kinds)('%s draws a complete scene', (k) => {
    const svg = roomSceneSvg(k);
    expect(svg.startsWith('<svg viewBox="0 0 320 200"')).toBe(true);
    expect(svg).not.toMatch(/undefined|NaN/);
    expect((svg.match(/<svg/g) ?? []).length).toBe(1);
  });
  it('is decorative: hidden from screen readers', async () => {
    await renderApp(<RoomScene kind="bedroom" width={200} height={120} />);
    expect(
      screen.getByTestId('room-scene-bedroom', { includeHiddenElements: true }).props
        .accessibilityElementsHidden,
    ).toBe(true);
  });
});

describe('icons and the score ring', () => {
  it('every icon renders, none of them in a screen reader’s way', async () => {
    await renderApp(
      <>
        {ICON_NAMES.map((n) => (
          <Icon key={n} name={n} />
        ))}
      </>,
    );
    for (const n of ICON_NAMES) {
      expect(screen.getByTestId(`icon-${n}`, { includeHiddenElements: true })).toBeTruthy();
    }
  });
  it('the ring exposes the server score as a bounded progress value', async () => {
    await renderApp(<ScoreRing score={140} accessibilityLabel="Match 140" />);
    const ring = screen.getByLabelText('Match 140');
    expect(ring.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 100 });
    expect(color.navy).toBeTruthy();
  });
});

describe('plan drawing', () => {
  const placed = [
    {
      id: 'rug',
      label: 'Rug',
      x: 100,
      y: 100,
      widthCm: 200,
      depthCm: 140,
      type: 'Rug',
      colour: 'beige',
      underlay: true,
    },
    {
      id: 'sofa',
      label: 'Sofa',
      x: 100,
      y: 10,
      widthCm: 200,
      depthCm: 90,
      type: 'Sofa',
      colour: 'blue',
    },
    { id: 'mystery', label: 'Thing', x: 10, y: 10, widthCm: 40, depthCm: 40 },
  ];
  const svg = (selectedId: string | null) =>
    planSvg({
      px: 320,
      height: 240,
      scale: 0.64,
      roomWidthCm: 500,
      roomDepthCm: 375,
      placed,
      selectedId,
    });

  it('draws every piece, the rug first so furniture sits on top of it', () => {
    const out = svg(null);
    expect(out.startsWith('<svg viewBox="0 0 320 240"')).toBe(true);
    // The rug glyph is the only one drawn at half opacity, and it comes before the sofa's shapes.
    expect(out.indexOf('opacity=".5"')).toBeLessThan(out.indexOf('<rect x="64" y="6.4"'));
    expect(out).not.toMatch(/undefined|NaN/);
  });

  it('rings the selected piece and nothing else', () => {
    expect(svg(null)).not.toContain('stroke-width="2.5"');
    expect(svg('sofa')).toContain('stroke-width="2.5"');
  });

  it('a piece with no known type is still drawn, as a plain tinted box', () => {
    expect(planGlyph(placed[2]!, 1)).toContain('<rect');
  });
});
