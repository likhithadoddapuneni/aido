import { errorMessage } from '@aidooi/i18n';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ar } from '../src/i18n/ar.ts';
import { en } from '../src/i18n/en.ts';
import * as fx from './fixtures.ts';
import { LOCATION_ID, problem, renderPortal, type Call, type Routes } from './harness.tsx';

afterEach(() => vi.unstubAllGlobals());

const label = (t: string) => new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

describe('role gating', () => {
  const ALL: Routes = {
    'GET /v1/seller/purchase-tasks': { body: { tasks: [] } },
    'GET /v1/seller/viewing-tasks': { body: [] },
    'GET /v1/seller/order-lines': { body: fx.linesPage() },
    'GET /v1/seller/issues': { body: fx.issuesPage },
    'GET /v1/seller/team': { body: fx.team },
    'GET /v1/seller/locations': { body: fx.locations },
  };
  const navLabels = () =>
    within(screen.getByRole('navigation'))
      .queryAllByRole('link')
      .map((a) => a.textContent);

  it('an owner sees every section', async () => {
    renderPortal({ role: 'seller_owner', routes: ALL });
    await screen.findByRole('navigation');
    expect(navLabels()).toEqual(
      expect.arrayContaining([
        en.navTeam,
        en.navImports,
        en.navStatements,
        en.navShowrooms,
        en.navProfile,
        en.navPerformance,
        en.navOffers,
      ]),
    );
  });

  it('a manager runs the catalogue and the money but cannot manage the team', async () => {
    renderPortal({ role: 'seller_manager', routes: ALL });
    await screen.findByRole('navigation');
    expect(navLabels()).toEqual(
      expect.arrayContaining([en.navImports, en.navStatements, en.navProfile]),
    );
    expect(navLabels()).not.toContain(en.navTeam);
  });

  it('staff see only the shop-floor work', async () => {
    renderPortal({ role: 'seller_staff', routes: ALL });
    await screen.findByRole('navigation');
    expect(navLabels()).toEqual(
      expect.arrayContaining([en.navOrders, en.navIssues, en.navTasks, en.navOffers]),
    );
    for (const hidden of [
      en.navTeam,
      en.navImports,
      en.navStatements,
      en.navShowrooms,
      en.navProfile,
      en.navPerformance,
      en.navProducts,
    ]) {
      expect(navLabels()).not.toContain(hidden);
    }
  });

  it.each([
    ['staff', '/team'],
    ['staff', '/imports'],
    ['staff', '/statements'],
    ['staff', '/offers/new'],
    ['staff', '/profile'],
    ['manager', '/team'],
  ] as const)(
    '%s opening %s by address gets an explanation and makes no data request',
    async (who, path) => {
      const { calls } = renderPortal({ role: `seller_${who}`, path, routes: ALL });
      expect(await screen.findByText(en.noAccessTitle)).toBeInTheDocument();
      const data = calls.filter(
        (c) => c.path.startsWith('/v1/seller/') && !['/v1/seller/locations'].includes(c.path),
      );
      expect(data).toEqual([]);
    },
  );

  it('the explanation is in Arabic too', async () => {
    renderPortal({ role: 'seller_staff', path: '/team', locale: 'ar', routes: ALL });
    expect(await screen.findByText(ar.noAccessTitle)).toBeInTheDocument();
  });
});

describe('dashboard', () => {
  it('counts what needs doing and links to it', async () => {
    renderPortal({
      routes: {
        'GET /v1/seller/purchase-tasks': { body: fx.purchaseTasks },
        'GET /v1/seller/viewing-tasks': { body: fx.viewingTasks },
        'GET /v1/seller/order-lines': {
          body: fx.linesPage([fx.line(), fx.line({ id: '44444444-4444-4444-8444-444444444442' })]),
        },
        'GET /v1/seller/issues': { body: fx.issuesPage },
      },
    });
    const tile = async (title: string) =>
      (await screen.findByRole('heading', { name: title })).closest('section') as HTMLElement;
    await waitFor(async () => expect(await tile(en.tilePendingTasks)).toHaveTextContent('2'));
    expect(await tile(en.tileToPrepare)).toHaveTextContent('2');
    expect(await tile(en.tileOpenIssues)).toHaveTextContent('1');
  });
});

describe('new offer', () => {
  const routes: Routes = {
    'GET /v1/seller/locations': { body: fx.locations },
    'GET /v1/products/AID-00000001': {
      body: { product: { id: 'AID-00000001', name: 'Oslo 3-seater sofa', type: 'Sofa' } },
    },
  };
  const fillOffer = async (user: ReturnType<typeof renderPortal>['user']) => {
    await user.type(await screen.findByLabelText(label(en.productId)), 'AID-00000001');
    await user.type(screen.getByLabelText(label(en.sku)), 'OSL-3');
    await user.type(screen.getByLabelText(label(en.sellingPrice)), '2499');
    await user.selectOptions(screen.getByLabelText(label(en.showroom)), LOCATION_ID);
  };

  it('creates an offer from a verified product with the price in fils', async () => {
    let call: Call | undefined;
    const { user, history } = renderPortal({
      path: '/offers/new',
      role: 'seller_manager',
      routes: {
        ...routes,
        'GET /v1/seller/offers': { body: fx.offersPage() },
        'POST /v1/seller/offers': (c) => (
          (call = c),
          {
            status: 201,
            body: {
              offer: fx.offer(),
              product: { ...fx.products.products[0], dataStatus: 'Verified' },
            },
          }
        ),
      },
    });
    await fillOffer(user);
    expect(await screen.findByText('Found: Oslo 3-seater sofa (Sofa)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: en.createOffer }));
    await waitFor(() => expect(history.location.pathname).toBe('/offers'));
    expect(call?.body).toEqual({
      productId: 'AID-00000001',
      sku: 'OSL-3',
      sellingPrice: 249_900,
      stockQty: 1,
      deliveryDays: 7,
      viewingStatus: 'Viewable on Request',
      locationId: LOCATION_ID,
    });
  });

  it('flags every missing field at once without calling the API', async () => {
    const { user, calls } = renderPortal({ path: '/offers/new', role: 'seller_manager', routes });
    await user.click(await screen.findByRole('button', { name: en.createOffer }));
    await waitFor(() =>
      expect(screen.getAllByRole('alert').some((a) => a.querySelector('a[href^="#"]'))).toBe(true),
    );
    const summary = screen
      .getAllByRole('alert')
      .find((a) => a.querySelector('a[href^="#"]')) as HTMLElement;
    for (const field of ['sku', 'sellingPrice', 'locationId', 'productId'])
      expect(summary.innerHTML).toContain(`#${field}`);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('puts a server field error (price below original) beside the field', async () => {
    const { user } = renderPortal({
      path: '/offers/new',
      role: 'seller_manager',
      routes: {
        ...routes,
        'POST /v1/seller/offers': problem(400, 'validation_failed', [
          { path: 'originalPrice', message: 'Original price must exceed the selling price' },
        ]),
      },
    });
    await fillOffer(user);
    await user.click(screen.getByRole('button', { name: en.createOffer }));
    expect(
      (await screen.findAllByText('Original price must exceed the selling price')).length,
    ).toBeGreaterThan(0);
  });

  it('says plainly when the product id does not exist', async () => {
    const { user } = renderPortal({
      path: '/offers/new',
      role: 'seller_manager',
      routes: { ...routes, 'GET /v1/products/AID-00000002': problem(404, 'not_found') },
    });
    await user.type(await screen.findByLabelText(label(en.productId)), 'AID-00000002');
    expect(await screen.findByText(en.productNotFound)).toBeInTheDocument();
  });

  it('submitting a new product sends it for review with its data', async () => {
    let call: Call | undefined;
    const { user } = renderPortal({
      path: '/offers/new',
      role: 'seller_manager',
      routes: {
        ...routes,
        'GET /v1/seller/offers': { body: fx.offersPage() },
        'POST /v1/seller/offers': (c) => (
          (call = c),
          { status: 201, body: { offer: fx.offer(), product: fx.products.products[0] } }
        ),
      },
    });
    await user.click(await screen.findByRole('tab', { name: en.newProduct }));
    await user.type(await screen.findByLabelText(label(en.productName)), 'Fjord side table');
    await user.type(screen.getByLabelText(label(en.sku)), 'FJ-1');
    await user.type(screen.getByLabelText(label(en.sellingPrice)), '350');
    await user.selectOptions(screen.getByLabelText(label(en.showroom)), LOCATION_ID);
    await user.click(screen.getByRole('button', { name: en.submitForReview }));
    await waitFor(() => expect(call).toBeDefined());
    expect(call?.body).toMatchObject({
      newProduct: { name: 'Fjord side table' },
      sku: 'FJ-1',
      sellingPrice: 35_000,
    });
  });
});

describe('product submissions', () => {
  it('lists them with what is missing and saves only what changed', async () => {
    let call: Call | undefined;
    const { user } = renderPortal({
      path: '/products',
      role: 'seller_manager',
      routes: {
        'GET /v1/seller/products': { body: fx.products },
        'PATCH /v1/seller/products/AID-00000009': (c) => (
          (call = c),
          { body: fx.products.products[0] }
        ),
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Edit offer: Fjord side table' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(await within(dialog).findByLabelText(label(en.material)), 'Wood');
    await user.click(within(dialog).getByRole('button', { name: en.save }));
    await waitFor(() => expect(call).toBeDefined());
    expect(call?.body).toEqual({ material: 'Wood' });
  });
});

describe('showrooms', () => {
  it('adds a showroom with opening hours', async () => {
    let call: Call | undefined;
    const { user } = renderPortal({
      path: '/showrooms',
      routes: {
        'GET /v1/seller/locations': { body: fx.locations },
        'POST /v1/seller/locations': (c) => (
          (call = c),
          { status: 201, body: fx.locations.locations[0] }
        ),
      },
    });
    await user.click(await screen.findByRole('button', { name: en.addShowroom }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(label(en.showroomName)), 'Abu Dhabi showroom');
    await user.type(within(dialog).getByLabelText(label(en.address)), 'Yas Mall');
    await user.type(within(dialog).getByLabelText(label(en.latitude)), '24.45');
    await user.type(within(dialog).getByLabelText(label(en.longitude)), '54.6');
    await user.click(within(dialog).getByRole('button', { name: 'Add opening time on Monday' }));
    await user.click(within(dialog).getByRole('button', { name: en.save }));
    await waitFor(() => expect(call).toBeDefined());
    expect(call?.body).toMatchObject({
      name: 'Abu Dhabi showroom',
      address: 'Yas Mall',
      lat: 24.45,
      lng: 54.6,
      openingHours: { mon: [{ open: '10:00', close: '19:00' }] },
    });
  });

  it('does not send a showroom with no name', async () => {
    const { user, calls } = renderPortal({
      path: '/showrooms',
      routes: { 'GET /v1/seller/locations': { body: fx.locations } },
    });
    await user.click(await screen.findByRole('button', { name: en.addShowroom }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: en.save }),
    );
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

describe('business profile', () => {
  it('shows the read-only record and saves only the editable fields', async () => {
    let call: Call | undefined;
    const { user } = renderPortal({
      path: '/profile',
      role: 'seller_manager',
      routes: {
        'GET /v1/seller/profile': { body: fx.profile },
        'PATCH /v1/seller/profile': (c) => ((call = c), { body: fx.profile }),
      },
    });
    expect(await screen.findByText('Nordic Living LLC')).toBeInTheDocument();
    const terms = screen.getByLabelText(label(en.afterSalesTerms));
    await user.clear(terms);
    await user.type(terms, '5 year warranty');
    await user.click(screen.getByRole('button', { name: en.save }));
    await waitFor(() => expect(call).toBeDefined());
    expect(Object.keys(call?.body as object).sort()).toEqual([
      'afterSalesTerms',
      'contactEmail',
      'contactPhone',
      'tradeName',
    ]);
    expect(call?.body).toMatchObject({ afterSalesTerms: '5 year warranty' });
  });

  it('rejects a phone number without a country code before sending', async () => {
    const { user, calls } = renderPortal({
      path: '/profile',
      role: 'seller_manager',
      routes: { 'GET /v1/seller/profile': { body: fx.profile } },
    });
    const phone = await screen.findByLabelText(label(en.contactPhone));
    await user.clear(phone);
    await user.type(phone, '0501234567');
    await user.click(screen.getByRole('button', { name: en.save }));
    expect((await screen.findAllByText(en.vInvalid)).length).toBeGreaterThan(0);
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });
});

describe('team', () => {
  it('invites a person with a role and a showroom', async () => {
    let call: Call | undefined;
    const { user } = renderPortal({
      path: '/team',
      routes: {
        'GET /v1/seller/team': { body: fx.team },
        'GET /v1/seller/locations': { body: fx.locations },
        'POST /v1/seller/team/invitations': (c) => ((call = c), { status: 201, body: {} }),
      },
    });
    await user.type(
      await screen.findByLabelText(label(en.name) as RegExp, { selector: '#invite-name' }),
      'Lina Floor',
    );
    await user.type(
      screen.getByLabelText(label(en.email), { selector: '#invite-email' }),
      'lina@seller.test',
    );
    await user.selectOptions(
      screen.getByLabelText(label(en.showroom), { selector: '#invite-location' }),
      LOCATION_ID,
    );
    await user.click(screen.getByRole('button', { name: en.sendInvite }));
    await waitFor(() => expect(call).toBeDefined());
    expect(call?.body).toEqual({
      fullName: 'Lina Floor',
      email: 'lina@seller.test',
      role: 'seller_staff',
      locationId: LOCATION_ID,
    });
  });

  it('changes a role, but never your own, and disabling asks first', async () => {
    let patch: Call | undefined;
    const other = fx.team.members[1];
    const { user } = renderPortal({
      path: '/team',
      routes: {
        'GET /v1/seller/team': { body: fx.team },
        'GET /v1/seller/locations': { body: fx.locations },
        [`PATCH /v1/seller/team/${other?.id}`]: (c) => ((patch = c), { body: other }),
      },
    });
    expect(await screen.findByRole('combobox', { name: 'Role for Sara Seller' })).toBeDisabled();
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Role for Omar Staff' }),
      'seller_manager',
    );
    await waitFor(() => expect(patch?.body).toEqual({ role: 'seller_manager' }));
    expect(screen.queryByRole('button', { name: 'Disable Sara Seller' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Disable Omar Staff' }));
    const dialog = await screen.findByRole('dialog');
    expect(patch?.body).toEqual({ role: 'seller_manager' }); // nothing sent yet
    await user.click(within(dialog).getByRole('button', { name: en.disable }));
    await waitFor(() => expect(patch?.body).toEqual({ status: 'Disabled' }));
  });

  it('a refusal to remove the last owner is explained through the catalogue', async () => {
    const other = fx.team.members[1];
    const { user } = renderPortal({
      path: '/team',
      routes: {
        'GET /v1/seller/team': { body: fx.team },
        'GET /v1/seller/locations': { body: fx.locations },
        [`PATCH /v1/seller/team/${other?.id}`]: problem(409, 'last_owner'),
      },
    });
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Role for Omar Staff' }),
      'seller_manager',
    );
    expect(await screen.findByText(errorMessage('last_owner', 'en'))).toBeInTheDocument();
  });
});

describe('statements', () => {
  it('opens a statement and downloads it as CSV with the session attached', async () => {
    const seen: { path: string; auth: string | null }[] = [];
    const saved: string[] = [];
    URL.createObjectURL = () => 'blob:x';
    URL.revokeObjectURL = () => undefined;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      saved.push(this.download);
    };
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input), 'http://localhost');
      if (url.pathname.endsWith('/csv')) {
        seen.push({ path: url.pathname, auth: new Headers(init?.headers).get('authorization') });
        return new Response('a,b');
      }
      return real(input, init);
    });
    const id = fx.statementDetail.id;
    const { user } = renderPortal({
      path: `/statements/${id}`,
      role: 'seller_manager',
      routes: { [`GET /v1/seller/statements/${id}`]: { body: fx.statementDetail } },
    });
    expect(await screen.findByText('TI-1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: en.downloadCsv }));
    await waitFor(() => expect(saved).toEqual(['statement-2026-09.csv']));
    expect(seen).toEqual([{ path: `/v1/seller/statements/${id}/csv`, auth: 'Bearer a' }]);
  });

  it('shows the net in AED from integer fils', async () => {
    const id = fx.statementDetail.id;
    const { container } = renderPortal({
      path: `/statements/${id}`,
      routes: { [`GET /v1/seller/statements/${id}`]: { body: fx.statementDetail } },
    });
    await screen.findByText('TI-1');
    // Integer fils on the wire; the formatted text is the component's business, the amount is ours.
    expect(container.querySelector('[data-fils="1000000"]')).toHaveTextContent('AED 10,000');
  });
});

describe('performance', () => {
  it('switches the period and asks the API for it', async () => {
    const { user, calls } = renderPortal({
      path: '/performance',
      routes: { 'GET /v1/seller/performance': { body: fx.performance } },
    });
    await screen.findByText(/90\W*%/);
    fireEvent.change(screen.getByLabelText(label(en.period)), { target: { value: '90d' } });
    await waitFor(() => expect(calls.some((c) => c.query.get('period') === '90d')).toBe(true));
    void user;
  });

  it('shows a dash, not 0%, when there is nothing to measure', async () => {
    const empty = {
      ...fx.performance,
      confirmation: {
        ...fx.performance.confirmation,
        purchase: { requests: 0, confirmed: 0, rate: null },
      },
    };
    renderPortal({
      path: '/performance',
      routes: { 'GET /v1/seller/performance': { body: empty } },
    });
    const card = (await screen.findByRole('heading', { name: en.purchaseConfirmations })).closest(
      'section',
    ) as HTMLElement;
    expect(card).toHaveTextContent('—');
    expect(card).not.toHaveTextContent('0%');
  });
});
