import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ar } from '../src/lib/catalogue.ar.ts';
import { en } from '../src/lib/catalogue.en.ts';
import {
  compatMaps,
  PRODUCT_ID,
  productDetail,
  productPage,
  productRow,
  productStats,
} from './fixtures.ts';
import { expectNoViolations, LOCALES, problem, renderConsole } from './harness.tsx';

const QUEUE = {
  'GET /v1/ops/products': { body: productPage() },
  'GET /v1/ops/products/stats': { body: productStats() },
};
const detail = (over: Record<string, unknown> = {}) => ({
  [`GET /v1/ops/products/${PRODUCT_ID}`]: { body: productDetail(over) },
});
const INCOMPLETE = {
  dataStatus: 'Incomplete',
  completeness: { missing: ['material'], invalid: ['widthCm'], complete: false },
};

describe('product verification queue', () => {
  for (const locale of LOCALES) {
    it(`lists the queue with stats and passes axe (${locale})`, async () => {
      const c = renderConsole({ path: '/products', locale, routes: QUEUE });
      expect(await screen.findByRole('link', { name: /Oslo 3-seater sofa/ })).toBeInTheDocument();
      expect(await screen.findByText('25%')).toBeInTheDocument();
      await expectNoViolations(c.container);
    });
  }

  it('defaults to the review queue and filters through the API', async () => {
    const c = renderConsole({ path: '/products', routes: QUEUE });
    await screen.findByRole('link', { name: /Oslo/ });
    expect(c.to('GET', '/v1/ops/products')[0]?.query.get('status')).toBe('Ready for Review');
    await c.user.selectOptions(screen.getByLabelText('Status'), 'Incomplete');
    await screen.findByRole('link', { name: /Oslo/ });
    expect(c.to('GET', '/v1/ops/products').at(-1)?.query.get('status')).toBe('Incomplete');
  });

  it('says how many problems an incomplete product has', async () => {
    renderConsole({
      path: '/products',
      routes: { ...QUEUE, 'GET /v1/ops/products': { body: productPage([productRow(INCOMPLETE)]) } },
    });
    expect(await screen.findByText('2 problem(s)')).toBeInTheDocument();
  });

  it('is closed to support and finance', async () => {
    renderConsole({ path: '/products', role: 'ops_support', routes: QUEUE });
    expect(
      await screen.findByRole('heading', { name: 'You do not have access to this' }),
    ).toBeInTheDocument();
  });

  it('turns a server failure into a retryable message', async () => {
    renderConsole({
      path: '/products',
      routes: { ...QUEUE, 'GET /v1/ops/products': problem(500, 'internal_error') },
    });
    expect(await screen.findByRole('button', { name: /retry|try again/i })).toBeInTheDocument();
  });
});

describe('product detail', () => {
  for (const locale of LOCALES) {
    it(`shows details, offers and history, and passes axe (${locale})`, async () => {
      const c = renderConsole({ path: `/products/${PRODUCT_ID}`, locale, routes: detail() });
      await screen.findByRole('heading', { level: 1, name: 'Oslo 3-seater sofa' });
      expect(screen.getByText(/210 × 95 × 85/)).toBeInTheDocument();
      expect(screen.getAllByText(/AED|د\.إ/).length).toBeGreaterThan(0);
      await expectNoViolations(c.container);
    });
  }

  it('cannot verify an incomplete product, and lists what is wrong', async () => {
    renderConsole({ path: `/products/${PRODUCT_ID}`, routes: detail(INCOMPLETE) });
    await screen.findByRole('heading', { level: 1, name: 'Oslo 3-seater sofa' });
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled();
    expect(screen.getByText('Missing: material')).toBeInTheDocument();
    expect(screen.getByText('Not valid: widthCm')).toBeInTheDocument();
  });

  it('verifies after a confirmation', async () => {
    const c = renderConsole({
      path: `/products/${PRODUCT_ID}`,
      routes: {
        ...detail(),
        [`POST /v1/ops/products/${PRODUCT_ID}/verify`]: {
          body: productDetail({ dataStatus: 'Verified' }),
        },
      },
    });
    await c.user.click(await screen.findByRole('button', { name: 'Verify' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/visible to buyers/)).toBeInTheDocument();
    expect(c.to('POST', `/v1/ops/products/${PRODUCT_ID}/verify`)).toHaveLength(0);
    await c.user.click(within(dlg).getByRole('button', { name: 'Verify' }));
    await screen.findByText('Product verified.');
    expect(c.to('POST', `/v1/ops/products/${PRODUCT_ID}/verify`)).toHaveLength(1);
  });

  it('rejection needs at least one reason; reasons go as a list, one per line', async () => {
    const c = renderConsole({
      path: `/products/${PRODUCT_ID}`,
      routes: {
        ...detail(),
        [`POST /v1/ops/products/${PRODUCT_ID}/reject`]: { body: productDetail() },
      },
    });
    await c.user.click(await screen.findByRole('button', { name: 'Reject' }));
    const dlg = await screen.findByRole('dialog');
    const send = within(dlg).getByRole('button', { name: 'Reject' });
    expect(send).toBeDisabled();
    await c.user.type(
      within(dlg).getByLabelText(/Reasons/),
      'Photos are blurry{Enter}Dimensions look wrong',
    );
    await c.user.click(send);
    await screen.findByText('Sent back to the seller.');
    expect(c.to('POST', `/v1/ops/products/${PRODUCT_ID}/reject`)[0]?.body).toEqual({
      reasons: ['Photos are blurry', 'Dimensions look wrong'],
    });
  });

  it('a seller-visible failure while taking a product out of circulation stays in the dialog', async () => {
    const c = renderConsole({
      path: `/products/${PRODUCT_ID}`,
      routes: {
        ...detail(),
        [`POST /v1/ops/products/${PRODUCT_ID}/deactivate`]: problem(403, 'forbidden'),
      },
    });
    await c.user.click(await screen.findByRole('button', { name: 'Take out of circulation' }));
    const dlg = await screen.findByRole('dialog');
    await c.user.click(within(dlg).getByRole('button', { name: 'Take out of circulation' }));
    expect(await within(dlg).findByText(/not allowed|permission|access/i)).toBeInTheDocument();
  });

  it('edits through a form and says editing sends a verified product back to review', async () => {
    const c = renderConsole({
      path: `/products/${PRODUCT_ID}`,
      routes: { ...detail(), [`PATCH /v1/ops/products/${PRODUCT_ID}`]: { body: productDetail() } },
    });
    await c.user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/sends it back to review/)).toBeInTheDocument();
    const width = within(dlg).getByLabelText(/Width/);
    await c.user.clear(width);
    await c.user.type(width, '220');
    await c.user.click(within(dlg).getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
    expect(c.to('PATCH', `/v1/ops/products/${PRODUCT_ID}`)[0]?.body).toMatchObject({
      widthCm: 220,
      depthCm: 95,
      secondaryColour: null,
    });
  });

  it('refuses a width of zero before calling the API', async () => {
    const c = renderConsole({ path: `/products/${PRODUCT_ID}`, routes: detail() });
    await c.user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dlg = await screen.findByRole('dialog');
    const width = within(dlg).getByLabelText(/Width/);
    await c.user.clear(width);
    await c.user.type(width, '0');
    await c.user.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await within(dlg).findByText(/out of range/)).toBeInTheDocument();
    expect(c.to('PATCH', `/v1/ops/products/${PRODUCT_ID}`)).toEqual([]);
  });
});

describe('compatibility maps', () => {
  const MAPS = (state: 'approved' | 'unapproved' = 'unapproved') => ({
    'GET /v1/ops/compat-maps': { body: compatMaps(state) },
  });

  for (const locale of LOCALES) {
    it(`shows each map's state and passes axe (${locale})`, async () => {
      const c = renderConsole({ path: '/compat-maps', locale, routes: MAPS() });
      await screen.findAllByRole('table');
      expect(screen.getAllByRole('table')).toHaveLength(2);
      expect(screen.getByText((locale === 'en' ? en : ar)['mp.noVersions'])).toBeInTheDocument();
      await expectNoViolations(c.container);
    });
  }

  it('approving needs the version typed and a review note', async () => {
    const c = renderConsole({
      path: '/compat-maps',
      routes: { ...MAPS(), 'POST /v1/ops/compat-maps/style/approve': { body: {} } },
    });
    const buttons = await screen.findAllByRole('button', { name: 'Approve this version' });
    // only style is unapproved; colour is approved, and material's mismatch needs a release, not a click
    expect(buttons).toHaveLength(1);
    expect(screen.getByText(/cannot be approved again/)).toBeInTheDocument();
    await c.user.click(buttons[0]!);
    const dlg = await screen.findByRole('dialog');
    const confirm = within(dlg).getByRole('button', { name: 'Approve this version' });
    expect(confirm).toBeDisabled();
    await c.user.type(within(dlg).getByLabelText(/Reason/), 'Reviewed with merchandising');
    expect(confirm).toBeDisabled(); // still needs the version typed
    await c.user.type(within(dlg).getByLabelText(/Type v4 to confirm|v4/), 'v4');
    expect(confirm).toBeEnabled();
    await c.user.click(confirm);
    await screen.findByText('Map approved.');
    expect(c.to('POST', '/v1/ops/compat-maps/style/approve')[0]?.body).toEqual({
      version: 'v4',
      reviewNote: 'Reviewed with merchandising',
    });
  });

  it('catalogue staff can read the maps but are told only an administrator can change them', async () => {
    renderConsole({ path: '/compat-maps', role: 'ops_catalogue', routes: MAPS() });
    await screen.findAllByRole('table');
    expect(
      screen.getByText('Only an administrator can approve or retire a map.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve this version' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retire' })).toBeNull();
  });

  it('retiring a version posts the reason', async () => {
    const c = renderConsole({
      path: '/compat-maps',
      routes: { ...MAPS('approved'), 'POST /v1/ops/compat-maps/style/retire': { body: {} } },
    });
    const retire = await screen.findAllByRole('button', { name: 'Retire' });
    await c.user.click(retire[0]!);
    const dlg = await screen.findByRole('dialog');
    await c.user.type(within(dlg).getByLabelText(/Reason/), 'Superseded');
    await c.user.type(within(dlg).getByLabelText(/v3/), 'v3');
    await c.user.click(within(dlg).getByRole('button', { name: 'Retire' }));
    await screen.findByText('Map retired.');
    expect(c.to('POST', '/v1/ops/compat-maps/style/retire')[0]?.body).toEqual({
      version: 'v3',
      reason: 'Superseded',
    });
  });
});
