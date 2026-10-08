import fc from 'fast-check';
import { fireEvent, screen } from '@testing-library/react-native';
import { ConceptPlan, collides, layoutPlan, type PlanItem } from '../src/index.ts';
import { renderApp } from './helpers.tsx';

const item = (id: string, w: number, d: number, extra: Partial<PlanItem> = {}): PlanItem => ({
  id,
  label: id,
  widthCm: w,
  depthCm: d,
  ...extra,
});

describe('layoutPlan', () => {
  it('places a sofa, table and lamp inside a living room with room to walk', () => {
    const r = layoutPlan({
      roomWidthCm: 500,
      roomDepthCm: 400,
      items: [item('sofa', 220, 95), item('table', 110, 60), item('lamp', 35, 35)],
    });
    expect(r.unplaced).toEqual([]);
    expect(r.placed.map((p) => p.id)).toEqual(['sofa', 'table', 'lamp']);
    for (const p of r.placed) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + p.widthCm).toBeLessThanOrEqual(500);
    }
  });

  it('keeps explicit positions, clamping them into the room', () => {
    const r = layoutPlan({
      roomWidthCm: 300,
      roomDepthCm: 300,
      items: [item('a', 100, 100, { x: 50, y: 60 }), item('b', 100, 100, { x: 290, y: -5 })],
    });
    expect(r.placed.find((p) => p.id === 'a')).toMatchObject({ x: 50, y: 60 });
    expect(r.placed.find((p) => p.id === 'b')).toMatchObject({ x: 200, y: 0 });
  });

  it('an explicit item that collides with an earlier one is re-placed rather than overlapping', () => {
    const r = layoutPlan({
      roomWidthCm: 400,
      roomDepthCm: 400,
      items: [item('a', 100, 100, { x: 0, y: 0 }), item('b', 100, 100, { x: 50, y: 50 })],
    });
    const [a, b] = [r.placed[0]!, r.placed[1]!];
    expect(collides(a, b, 0)).toBe(false);
  });

  it('GATE: what cannot fit is reported, never drawn outside the room or on top of something', () => {
    const r = layoutPlan({
      roomWidthCm: 200,
      roomDepthCm: 200,
      items: [item('huge', 300, 100), item('ok', 100, 100)],
    });
    expect(r.unplaced).toEqual(['huge']);
    expect(r.placed.map((p) => p.id)).toEqual(['ok']);
    const full = layoutPlan({
      roomWidthCm: 120,
      roomDepthCm: 120,
      items: [item('a', 100, 100), item('b', 100, 100)],
    });
    expect(full.placed).toHaveLength(1);
    expect(full.unplaced).toHaveLength(1);
  });

  it('is deterministic and does not depend on input order for auto-placed items', () => {
    const items = [item('c', 80, 80), item('a', 200, 90), item('b', 120, 60)];
    const one = layoutPlan({ roomWidthCm: 450, roomDepthCm: 350, items });
    const two = layoutPlan({ roomWidthCm: 450, roomDepthCm: 350, items: [...items].reverse() });
    const pos = (r: typeof one) => Object.fromEntries(r.placed.map((p) => [p.id, [p.x, p.y]]));
    expect(pos(two)).toEqual(pos(one));
  });

  const itemArb = (i: number) =>
    fc
      .record({
        widthCm: fc.integer({ min: 20, max: 320 }),
        depthCm: fc.integer({ min: 20, max: 220 }),
        pos: fc.option(
          fc.tuple(fc.integer({ min: -50, max: 700 }), fc.integer({ min: -50, max: 500 })),
          { nil: undefined },
        ),
      })
      .map(({ widthCm, depthCm, pos }): PlanItem => ({
        id: `i${i}`,
        label: `Item ${i}`,
        widthCm,
        depthCm,
        ...(pos ? { x: pos[0], y: pos[1] } : {}),
      }));

  it('PROPERTY: every placed item is inside the room and no two placed items overlap', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 150, max: 800 }),
        fc.integer({ min: 150, max: 600 }),
        fc
          .integer({ min: 0, max: 12 })
          .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => itemArb(i)))),
        (W, D, items) => {
          const r = layoutPlan({ roomWidthCm: W, roomDepthCm: D, items });
          expect(r.placed.length + r.unplaced.length).toBe(items.length);
          for (const p of r.placed) {
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.y).toBeGreaterThanOrEqual(0);
            expect(p.x + p.widthCm).toBeLessThanOrEqual(W);
            expect(p.y + p.depthCm).toBeLessThanOrEqual(D);
          }
          for (let i = 0; i < r.placed.length; i++)
            for (let j = i + 1; j < r.placed.length; j++)
              expect(collides(r.placed[i]!, r.placed[j]!, 0)).toBe(false);
          expect(new Set([...r.placed.map((p) => p.id), ...r.unplaced]).size).toBe(items.length);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('PROPERTY: the layout is a pure function of its input', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 200, max: 700 }),
        fc.integer({ min: 200, max: 500 }),
        fc.tuple(itemArb(0), itemArb(1), itemArb(2)),
        (W, D, items) => {
          expect(layoutPlan({ roomWidthCm: W, roomDepthCm: D, items })).toEqual(
            layoutPlan({ roomWidthCm: W, roomDepthCm: D, items }),
          );
        },
      ),
    );
  });
});

describe('ConceptPlan', () => {
  const items = [
    item('sofa', 220, 95, { label: 'Hale Sofa' }),
    item('rug', 200, 300, { label: 'Nori Rug' }),
  ];

  it('GATE: is labelled "Concept" and says it is not a photograph (AID-LOG-011), in both languages', async () => {
    await renderApp(<ConceptPlan roomWidthCm={500} roomDepthCm={400} items={items} width={320} />);
    expect(screen.getByLabelText('Concept')).toBeTruthy();
    expect(screen.getByText('A measured concept plan, not a photograph.')).toBeTruthy();
    await renderApp(<ConceptPlan roomWidthCm={500} roomDepthCm={400} items={items} width={320} />, {
      locale: 'ar',
    });
    expect(screen.getByLabelText('تصور')).toBeTruthy();
  });

  it('every product is a labelled, tappable element with its measured size', async () => {
    const onSelect = jest.fn();
    await renderApp(
      <ConceptPlan
        roomWidthCm={500}
        roomDepthCm={400}
        items={items}
        width={320}
        onSelect={onSelect}
      />,
    );
    const sofa = screen.getByRole('button', { name: 'Hale Sofa, 220 × 95 cm' });
    await fireEvent.press(sofa);
    expect(onSelect).toHaveBeenCalledWith('sofa');
    expect(screen.getByRole('button', { name: 'Nori Rug, 200 × 300 cm' })).toBeTruthy();
  });

  it('marks the selected product', async () => {
    await renderApp(
      <ConceptPlan
        roomWidthCm={500}
        roomDepthCm={400}
        items={items}
        width={320}
        selectedId="rug"
      />,
    );
    expect(screen.getByRole('button', { name: /Nori Rug/ }).props.accessibilityState).toMatchObject(
      { selected: true },
    );
    expect(
      screen.getByRole('button', { name: /Hale Sofa/ }).props.accessibilityState,
    ).toMatchObject({ selected: false });
  });

  it('summarises the room for screen readers and warns about items that do not fit', async () => {
    await renderApp(
      <ConceptPlan
        roomWidthCm={200}
        roomDepthCm={200}
        items={[item('big', 400, 100)]}
        width={300}
      />,
    );
    expect(
      screen.getByLabelText('Room plan, 200 by 200 centimetres, 0 items.', {
        includeHiddenElements: true,
      }),
    ).toBeTruthy();
    expect(screen.getByText('1 items do not fit the plan.')).toBeTruthy();
  });

  it('the plan is physical geometry: it does not mirror in right-to-left', async () => {
    await renderApp(<ConceptPlan roomWidthCm={500} roomDepthCm={400} items={items} width={320} />, {
      locale: 'ar',
    });
    expect(
      (screen.getByTestId('concept-plan').props.style as { direction?: string }).direction,
    ).toBe('ltr');
  });
});

describe('layoutPlan: where a person would put things', () => {
  const room = { roomWidthCm: 500, roomDepthCm: 400 };
  const at = (r: ReturnType<typeof layoutPlan>, id: string) => r.placed.find((p) => p.id === id)!;

  it('puts the sofa against the top wall, centred, and the coffee table in the middle', () => {
    const r = layoutPlan({
      ...room,
      items: [
        item('table', 110, 60, { type: 'Coffee Table' }),
        item('sofa', 220, 95, { type: 'Sofa' }),
      ],
    });
    expect(at(r, 'sofa').x).toBe(140);
    expect(at(r, 'sofa').y).toBe(10);
    expect(at(r, 'table')).toMatchObject({ x: 195, y: 170 });
  });

  it('sends a second large piece to the opposite wall and lamps to the corners', () => {
    const r = layoutPlan({
      ...room,
      items: [
        item('sofa', 220, 95, { type: 'Sofa' }),
        item('tv', 160, 45, { type: 'TV Unit' }),
        item('lamp', 35, 35, { type: 'Floor Lamp' }),
      ],
    });
    expect(at(r, 'tv').y).toBe(400 - 45 - 10);
    expect(at(r, 'lamp')).toMatchObject({ x: 10, y: 10 });
  });

  it('puts a bedside table next to the bed', () => {
    const r = layoutPlan({
      ...room,
      items: [
        item('bed', 180, 210, { type: 'Bed' }),
        item('side', 45, 40, { type: 'Bedside Table' }),
      ],
    });
    const bed = at(r, 'bed');
    const side = at(r, 'side');
    expect(side.y).toBe(bed.y);
    expect(side.x + side.widthCm).toBeLessThanOrEqual(bed.x);
  });

  it('a rug lies under everything: centred, never blocking, never blocked', () => {
    const r = layoutPlan({
      ...room,
      items: [
        item('rug', 240, 160, { type: 'Rug', underlay: true }),
        item('sofa', 220, 95, { type: 'Sofa' }),
        item('table', 110, 60, { type: 'Coffee Table' }),
      ],
    });
    expect(r.unplaced).toEqual([]);
    expect(at(r, 'rug')).toMatchObject({ x: 130, y: 120, underlay: true });
    expect(collides(at(r, 'sofa'), at(r, 'table'), 0)).toBe(false);
  });

  it('falls back to scanning when a preferred place is taken, and still never overlaps', () => {
    const r = layoutPlan({
      roomWidthCm: 300,
      roomDepthCm: 300,
      items: [
        item('a', 200, 90, { type: 'Sofa' }),
        item('b', 200, 90, { type: 'Sofa' }),
        item('c', 200, 90, { type: 'Sofa' }),
      ],
    });
    for (let i = 0; i < r.placed.length; i++)
      for (let j = i + 1; j < r.placed.length; j++)
        expect(collides(r.placed[i]!, r.placed[j]!, 0)).toBe(false);
  });
});
