import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { BudgetScreen } from '../src/features/discovery/BudgetScreen.tsx';
import { CompositionScreen } from '../src/features/discovery/CompositionScreen.tsx';
import { HomeScreen } from '../src/features/discovery/HomeScreen.tsx';
import { OptionsScreen } from '../src/features/discovery/OptionsScreen.tsx';
import { ProjectsScreen } from '../src/features/discovery/ProjectsScreen.tsx';
import { ReplaceScreen } from '../src/features/discovery/ReplaceScreen.tsx';
import { memoryKv } from '../src/storage/index.ts';
import { PATH_IDS } from '../src/projects/wizard.ts';
import { composition, offer, project, recommendation, run } from './fixtures.ts';
import { fakeApi, problem, renderApp, router } from './support.tsx';

const P = project();
const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));

describe('home', () => {
  it('offers the eight paths and routes to that path’s wizard', async () => {
    await renderApp(<HomeScreen />);
    expect(await screen.findByText('What are you furnishing?')).toBeTruthy();
    for (const label of [
      'Living room',
      'Bedroom',
      'Dining room',
      'Home office',
      'Studio apartment',
      'Full apartment',
      'Villa',
      'A single product',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(PATH_IDS).toHaveLength(8);
    await fireEvent.press(screen.getByText('Villa'));
    expect(router.push).toHaveBeenCalledWith('/project/new/villa');
  });

  it('is in Arabic when the stored language is Arabic, with every path translated', async () => {
    await renderApp(<HomeScreen />, { kv: memoryKv({ 'aidooi.locale.v1': 'ar' }) });
    expect(await screen.findByText('ماذا تريد أن تؤثّث؟')).toBeTruthy();
    expect(screen.getByText('غرفة المعيشة')).toBeTruthy();
    expect(screen.getByText('فيلا')).toBeTruthy();
    expect(screen.queryByText('Living room')).toBeNull();
  });
});

describe('projects', () => {
  it('shows an empty state with a way to start', async () => {
    await renderApp(<ProjectsScreen />, {
      api: fakeApi({ 'GET /v1/projects': () => ({ body: { projects: [] } }) }),
    });
    expect(await screen.findByText('No projects yet')).toBeTruthy();
    await press('Start a project');
    expect(router.push).toHaveBeenCalledWith('/(tabs)/home');
  });

  it('lists projects and resumes straight into the options, asking nothing again', async () => {
    await renderApp(<ProjectsScreen />, {
      api: fakeApi({ 'GET /v1/projects': () => ({ body: { projects: [P] } }) }),
    });
    await fireEvent.press(await screen.findByText('Living room'));
    expect(router.push).toHaveBeenCalledWith(`/project/${P.id}/options`);
  });

  it('shows a translated error with the support reference and a working retry', async () => {
    let fail = true;
    const api = fakeApi({
      'GET /v1/projects': () =>
        fail ? problem(503, 'internal_error') : { body: { projects: [] } },
    });
    await renderApp(<ProjectsScreen />, { api });
    expect(
      await screen.findByText('Something went wrong on our side. Please try again in a moment.'),
    ).toBeTruthy();
    expect(screen.getByText(/corr-1234/)).toBeTruthy();
    fail = false;
    await press('Try again');
    expect(await screen.findByText('No projects yet')).toBeTruthy();
  });
});

describe('budget', () => {
  const cards = {
    cards: ['Essential', 'Value', 'Standard', 'Premium', 'Luxury'].map((tier, i) => ({
      tier,
      lowFils: 100_000 * (i + 1),
      highFils: 100_000 * (i + 2),
      blurb: 'x',
    })),
  };

  it('shows the derived size class read-only and the five tiers with their ranges; choosing one updates the project and moves on', async () => {
    const api = fakeApi({
      'GET /v1/projects/{id}': () => ({ body: P }),
      'GET /v1/projects/{id}/budget-cards': () => ({ body: cards }),
      'PUT /v1/projects/{id}': () => ({ body: P }),
    });
    await renderApp(<BudgetScreen projectId={P.id} />, { api });
    expect(await screen.findByText('Room size: Medium')).toBeTruthy();
    for (const tier of ['Essential', 'Value', 'Standard', 'Premium', 'Luxury'])
      expect(screen.getByText(tier)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Premium'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/project/${P.id}/options`));
    const put = api.called('PUT', `/v1/projects/${P.id}`)[0];
    expect((put?.body as { input: { tier: string } }).input.tier).toBe('Premium');
  });

  it('for a whole property, choosing a tier also sets the total budget to that tier’s ceiling', async () => {
    const apt = project({
      input: {
        pathId: 'fullApartment',
        bedrooms: 2,
        office: false,
        bedroomConsistency: false,
        totalBudgetFils: 5_000_000,
        style: 'modern',
        colour: 'grey',
        tier: 'Value',
      },
      sizeClass: null,
    });
    const api = fakeApi({
      'GET /v1/projects/{id}': () => ({ body: apt }),
      'GET /v1/projects/{id}/budget-cards': () => ({ body: cards }),
      'PUT /v1/projects/{id}': () => ({ body: apt }),
    });
    await renderApp(<BudgetScreen projectId={apt.id} />, { api });
    await fireEvent.press(await screen.findByLabelText('Luxury'));
    await waitFor(() => expect(api.called('PUT', `/v1/projects/${apt.id}`)).toHaveLength(1));
    expect(
      (
        api.called('PUT', `/v1/projects/${apt.id}`)[0]?.body as {
          input: { totalBudgetFils: number };
        }
      ).input.totalBudgetFils,
    ).toBe(600_000);
  });
});

describe('options', () => {
  const routes = (rec: unknown) => ({
    'GET /v1/projects/{id}': () => ({ body: P }),
    'POST /v1/projects/{id}/recommend': () => ({ body: rec }),
  });

  it('shows four options with their score, total and objective, and opens the room view', async () => {
    await renderApp(<OptionsScreen projectId={P.id} />, { api: fakeApi(routes(recommendation())) });
    expect(await screen.findByText('Best overall')).toBeTruthy();
    for (const l of ['Best value', 'Best style match', 'Premium choice'])
      expect(screen.getByText(l)).toBeTruthy();
    expect(screen.queryByText(/Stock is limited/)).toBeNull();
    await fireEvent.press(screen.getByLabelText('Best overall, match score 88'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/composition/[id]',
      params: { id: composition().id, projectId: P.id },
    });
  });

  it('is honest about limited inventory: fewer options, said plainly, never padded', async () => {
    const r = run({
      status: 'Limited Inventory',
      compositions: [
        composition(),
        composition({ id: '44444444-4444-4444-8444-444444444445', objective: 'best_value' }),
      ],
    });
    await renderApp(<OptionsScreen projectId={P.id} />, {
      api: fakeApi(routes(recommendation([r]))),
    });
    expect(await screen.findByText(/Stock is limited, so we are showing 2 options/)).toBeTruthy();
    expect(screen.queryByText('Premium choice')).toBeNull();
  });

  it('flags a stale run and offers to refresh it', async () => {
    const r = run({ compositions: [composition({ stale: true })] });
    await renderApp(<OptionsScreen projectId={P.id} />, {
      api: fakeApi(routes(recommendation([r]))),
    });
    expect(
      await screen.findByText(/Prices or availability changed since these were made/),
    ).toBeTruthy();
    expect(screen.getByText('Out of date')).toBeTruthy();
  });

  it('a failed run says what to do next instead of an empty page', async () => {
    const r = run({
      status: 'Failed',
      reason: 'No eligible product for essential Sofa',
      compositions: [],
    });
    await renderApp(<OptionsScreen projectId={P.id} />, {
      api: fakeApi(routes(recommendation([r]))),
    });
    expect(await screen.findByText('We could not complete a room for this budget')).toBeTruthy();
    await press('Change budget');
    expect(router.push).toHaveBeenCalledWith(`/project/${P.id}/budget`);
  });

  it('a whole property shows each room, the total against the budget, and the budget constraint', async () => {
    const rec = recommendation(
      [
        run({ moduleLabel: 'Master Bedroom' }),
        run({ id: '66666666-6666-4666-8666-666666666667', moduleLabel: 'Living Room' }),
      ],
      {
        totalBudgetFils: 5_000_000,
        bestOverallTotalFils: 5_400_000,
        constraint: 'Budget Constraint: …',
      },
    );
    await renderApp(<OptionsScreen projectId={P.id} />, { api: fakeApi(routes(rec)) });
    expect(await screen.findByText('Master Bedroom')).toBeTruthy();
    expect(screen.getByText('Living Room')).toBeTruthy();
    expect(screen.getByText('Your budget is tight')).toBeTruthy();
  });

  it('shows the server’s refusal translated (for example when the style map is not approved)', async () => {
    await renderApp(<OptionsScreen projectId={P.id} />, {
      api: fakeApi({
        ...routes(null),
        'POST /v1/projects/{id}/recommend': () => problem(422, 'compat_map_not_approved'),
      }),
    });
    expect(
      await screen.findByText(
        'Recommendations are not available right now. Please try again later.',
      ),
    ).toBeTruthy();
  });

  it('an individual product is ranked, with the price range the server computed', async () => {
    const single = project({
      input: {
        pathId: 'individualProduct',
        productType: 'Floor Lamp',
        branch: null,
        style: 'modern',
        colour: 'black',
        tier: 'Value',
      },
      sizeClass: null,
    });
    const api = fakeApi({
      'GET /v1/projects/{id}': () => ({ body: single }),
      'POST /v1/projects/{id}/rank': () => ({
        body: {
          tier: 'Value',
          priceRange: { lowFils: 15_000, highFils: 30_000 },
          results: [
            {
              match: {
                score: 90,
                classification: 'Excellent Match',
                fit: 100,
                style: 100,
                colour: 100,
                budget: 100,
              },
              product: composition().items[0]!.product,
              offer: offer('AIO-00000009', 22_000),
            },
          ],
        },
      }),
    });
    await renderApp(<OptionsScreen projectId={single.id} />, { api });
    expect(await screen.findByText('Value range')).toBeTruthy();
    expect(screen.getByText('Orla Sofa 3-Seater')).toBeTruthy();
    expect(api.called('POST', `/v1/projects/${single.id}/recommend`)).toHaveLength(0);
  });
});

describe('room view and product card', () => {
  const C = composition();
  const productCard = {
    product: C.items[0]!.product,
    offers: [
      offer('AIO-00000001', 450_000),
      {
        ...offer('AIO-00000077', 430_000),
        partner: { id: 'p2', tradeName: 'Al Quoz Furniture', afterSalesTerms: null },
      },
    ],
  };
  const routes = (c = C) => ({
    'GET /v1/compositions/{id}': () => ({ body: c }),
    'GET /v1/products/{id}': () => ({ body: productCard }),
  });

  it('draws the measured concept plan, labelled Concept, with every product listed', async () => {
    await renderApp(<CompositionScreen compositionId={C.id} projectId={P.id} />, {
      api: fakeApi(routes()),
    });
    expect(await screen.findByText('Best overall')).toBeTruthy();
    expect(screen.getByLabelText('Concept')).toBeTruthy();
    expect(screen.getAllByText('Orla Sofa 3-Seater').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Form Vase').length).toBeTruthy();
  });

  it('tapping a product opens its card: dimensions, live offers, viewing status, delivery and the seller’s after-sales terms', async () => {
    await renderApp(<CompositionScreen compositionId={C.id} projectId={P.id} />, {
      api: fakeApi(routes()),
    });
    await fireEvent.press((await screen.findAllByText('Orla Sofa 3-Seater'))[0]!);
    expect(await screen.findByText(/215 × 92 × \d+ cm/)).toBeTruthy();
    expect(await screen.findByText('Marina Living')).toBeTruthy();
    expect(screen.getByText('Al Quoz Furniture')).toBeTruthy();
    expect(screen.getByText(/Returns within 7 days if unused/)).toBeTruthy();
    expect(screen.getAllByText('On display').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Delivery in 3 days').length).toBeGreaterThan(0);
  });

  it('an essential product can be replaced but not removed; the card says why', async () => {
    await renderApp(<CompositionScreen compositionId={C.id} projectId={P.id} />, {
      api: fakeApi(routes()),
    });
    await fireEvent.press((await screen.findAllByText('Orla Sofa 3-Seater'))[0]!);
    expect(await screen.findByText(/essential to the room/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    await press('Replace');
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/composition/[id]/item/[slot]',
      params: { id: C.id, slot: 'Sofa#0' },
    });
  });

  it('removing a non-essential product takes two taps and shows the server’s recalculated room', async () => {
    const after = composition({ total: 888_000, items: [C.items[0]!] });
    const api = fakeApi({
      ...routes(),
      'DELETE /v1/compositions/{id}/items/{slot}': () => ({ body: after }),
    });
    await renderApp(<CompositionScreen compositionId={C.id} projectId={P.id} />, { api });
    await fireEvent.press(await screen.findByText('Form Vase'));
    await press('Remove');
    expect(api.called('DELETE', '/v1/compositions')).toHaveLength(0); // one tap is not enough
    await press('Tap again to remove');
    await waitFor(() => expect(api.called('DELETE', '/v1/compositions')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText('Form Vase')).toBeNull());
  });

  it('a stale composition says so, flags the changed item, and the refresh action returns to fresh options', async () => {
    const stale = composition({
      stale: true,
      items: [{ ...C.items[0]!, stale: 'price_changed', match: null }, C.items[1]!],
    });
    await renderApp(<CompositionScreen compositionId={C.id} projectId={P.id} />, {
      api: fakeApi(routes(stale)),
    });
    expect(await screen.findByText(/Something here changed price or availability/)).toBeTruthy();
    expect(screen.getByText('Price changed')).toBeTruthy();
    await press('Refresh');
    expect(router.replace).toHaveBeenCalledWith(`/project/${P.id}/options`);
  });

  it('without room dimensions it does not pretend: no plan, a plain note', async () => {
    await renderApp(<CompositionScreen compositionId={C.id} />, {
      api: fakeApi(routes(composition({ room: null }))),
    });
    expect(await screen.findByText('We do not have the room dimensions for a plan.')).toBeTruthy();
    expect(screen.queryByLabelText('Concept')).toBeNull();
  });
});

describe('replace', () => {
  const alt = (id: string, price: number, delta: number) => ({
    match: { score: 86, classification: 'Strong Match', fit: 100 },
    product: { ...composition().items[0]!.product, name: `Alt ${id}` },
    offer: offer(id, price),
    priceDelta: delta,
  });
  const alts = {
    alternatives: [
      alt('AIO-00000011', 400_000, -50_000),
      alt('AIO-00000012', 520_000, 70_000),
      alt('AIO-00000013', 450_000, 0),
    ],
  };

  it('lists alternatives with how much cheaper or dearer each is, and applies the chosen one', async () => {
    const updated = composition({ total: 850_000 });
    const api = fakeApi({
      'GET /v1/compositions/{id}/items/{slot}/alternatives': () => ({ body: alts }),
      'PUT /v1/compositions/{id}/items/{slot}': () => ({ body: updated }),
    });
    const { client } = await renderApp(
      <ReplaceScreen compositionId={composition().id} slotKey="Sofa#0" />,
      { api },
    );
    expect(await screen.findByText(/AED 500 less/)).toBeTruthy();
    expect(screen.getByText(/AED 700 more/)).toBeTruthy();
    expect(screen.getByText(/Same price/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Alt AIO-00000011, Marina Living'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect((api.called('PUT', '/v1/compositions')[0]?.body as { offerId: string }).offerId).toBe(
      'AIO-00000011',
    );
    expect(client.getQueryData(['composition', composition().id])).toEqual(updated);
  });

  it('shows the server’s revalidation refusal, translated, and stays on the screen', async () => {
    const api = fakeApi({
      'GET /v1/compositions/{id}/items/{slot}/alternatives': () => ({ body: alts }),
      'PUT /v1/compositions/{id}/items/{slot}': () => problem(422, 'composition_invalid'),
    });
    await renderApp(<ReplaceScreen compositionId={composition().id} slotKey="Sofa#0" />, { api });
    await fireEvent.press(await screen.findByLabelText('Alt AIO-00000012, Marina Living'));
    expect(
      await screen.findByText(
        'That change would stop this room working as a whole. Please choose a different product.',
      ),
    ).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('says so when nothing else suits the spot', async () => {
    const api = fakeApi({
      'GET /v1/compositions/{id}/items/{slot}/alternatives': () => ({ body: { alternatives: [] } }),
    });
    await renderApp(<ReplaceScreen compositionId={composition().id} slotKey="Sofa#0" />, { api });
    expect(await screen.findByText('No replacements available')).toBeTruthy();
  });
});
