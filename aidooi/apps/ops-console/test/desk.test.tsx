import { vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_ID,
  customer,
  ISSUE_ID,
  issuePage,
  ORDER_ID,
  orderDetail,
  orderPage,
  VIEWING_ID,
  viewingDetail,
  viewingPage,
} from './fixtures.ts';
import { expectNoViolations, LOCALES, problem, renderConsole } from './harness.tsx';

const ORDER = {
  [`GET /v1/ops/orders/${ORDER_ID}`]: { body: orderDetail() },
};

describe('orders', () => {
  for (const locale of LOCALES) {
    it(`searches and lists, and passes axe (${locale})`, async () => {
      const c = renderConsole({
        path: '/orders',
        locale,
        routes: { 'GET /v1/ops/orders': { body: orderPage() } },
      });
      expect(await screen.findAllByText(/AED|د\.إ/)).not.toHaveLength(0);
      await expectNoViolations(c.container);
    });
  }

  it('sends the search term to the API', async () => {
    const c = renderConsole({
      path: '/orders',
      routes: { 'GET /v1/ops/orders': { body: orderPage() } },
    });
    await screen.findByRole('link', { name: ORDER_ID.slice(0, 8) });
    await c.user.type(screen.getByLabelText('Order number or customer'), 'layla');
    await screen.findByRole('link', { name: ORDER_ID.slice(0, 8) });
    await vi.waitFor(() =>
      expect(c.to('GET', '/v1/ops/orders').at(-1)?.query.get('search')).toBe('layla'),
    );
  });

  for (const locale of LOCALES) {
    it(`order detail tells the viewer the read is logged and passes axe (${locale})`, async () => {
      const c = renderConsole({ path: `/orders/${ORDER_ID}`, locale, routes: ORDER });
      expect(await screen.findByRole('note')).toBeInTheDocument();
      await screen.findByText('Villa 4, Al Barsha, Dubai');
      await expectNoViolations(c.container);
    });
  }

  it('shows delivery, lines, ledger and the audit trail', async () => {
    renderConsole({ path: `/orders/${ORDER_ID}`, routes: ORDER });
    await screen.findByText('Villa 4, Al Barsha, Dubai');
    expect(screen.getByText('Layla Buyer')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Items' })).toHaveTextContent('Oslo 3-seater sofa');
    expect(screen.getByRole('table', { name: 'Ledger' })).toHaveTextContent('escrow');
    expect(screen.getByText('No refunds.')).toBeInTheDocument();
  });

  it('does not fetch the customer until asked: that read is audited', async () => {
    const c = renderConsole({
      path: `/orders/${ORDER_ID}`,
      routes: { ...ORDER, [`GET /v1/ops/customers/${CUSTOMER_ID}`]: { body: customer() } },
    });
    await screen.findByText('Villa 4, Al Barsha, Dubai');
    expect(c.to('GET', `/v1/ops/customers/${CUSTOMER_ID}`)).toHaveLength(0);
    await c.user.click(screen.getByRole('button', { name: 'Show customer summary' }));
    await screen.findByText('+9715•••••22');
    expect(c.to('GET', `/v1/ops/customers/${CUSTOMER_ID}`)).toHaveLength(1);
  });

  it('adds a note and refuses an empty one', async () => {
    const c = renderConsole({
      path: `/orders/${ORDER_ID}`,
      routes: {
        ...ORDER,
        [`POST /v1/ops/orders/${ORDER_ID}/notes`]: {
          body: {
            id: ORDER_ID,
            opsUserId: ORDER_ID,
            body: 'x',
            createdAt: '2026-10-07T08:00:00.000Z',
          },
        },
      },
    });
    await screen.findByText('Called the buyer.');
    await c.user.click(screen.getByRole('button', { name: 'Add a note' }));
    expect(await screen.findByText('This is required.')).toBeInTheDocument();
    expect(c.to('POST', `/v1/ops/orders/${ORDER_ID}/notes`)).toEqual([]);
    await c.user.type(screen.getByLabelText('Add a note'), 'Rebooked delivery');
    await c.user.click(screen.getByRole('button', { name: 'Add a note' }));
    await screen.findByText('Note added.');
    expect(c.to('POST', `/v1/ops/orders/${ORDER_ID}/notes`)[0]?.body).toEqual({
      body: 'Rebooked delivery',
    });
  });

  it('finance reads orders but cannot add notes', async () => {
    renderConsole({ path: `/orders/${ORDER_ID}`, role: 'ops_finance', routes: ORDER });
    await screen.findByText('Called the buyer.');
    expect(screen.queryByRole('button', { name: 'Add a note' })).toBeNull();
  });

  it('catalogue staff are sent away from the desk', async () => {
    const c = renderConsole({ path: '/orders', role: 'ops_catalogue' });
    expect(
      await screen.findByRole('heading', { name: 'You do not have access to this' }),
    ).toBeInTheDocument();
    expect(c.to('GET', '/v1/ops/orders')).toEqual([]);
  });

  it('shows a missing order as an error with a way back, not a blank page', async () => {
    renderConsole({
      path: `/orders/${ORDER_ID}`,
      routes: { [`GET /v1/ops/orders/${ORDER_ID}`]: problem(404, 'not_found') },
    });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('viewings', () => {
  for (const locale of LOCALES) {
    it(`lists and shows one viewing, and passes axe (${locale})`, async () => {
      const list = renderConsole({
        path: '/viewings',
        locale,
        routes: { 'GET /v1/ops/viewings': { body: viewingPage() } },
      });
      expect(await screen.findByRole('link', { name: VIEWING_ID.slice(0, 8) })).toBeInTheDocument();
      await expectNoViolations(list.container);
      list.unmount();
      const one = renderConsole({
        path: `/viewings/${VIEWING_ID}`,
        locale,
        routes: { [`GET /v1/ops/viewings/${VIEWING_ID}`]: { body: viewingDetail() } },
      });
      expect(await screen.findByRole('note')).toBeInTheDocument();
      expect(await screen.findByRole('link', { name: 'AID-00000001' })).toBeInTheDocument();
      await expectNoViolations(one.container);
    });
  }
});

describe('issues', () => {
  const ISSUES = { 'GET /v1/ops/issues': { body: issuePage() } };

  for (const locale of LOCALES) {
    it(`lists open issues and passes axe (${locale})`, async () => {
      const c = renderConsole({ path: '/issues', locale, routes: ISSUES });
      expect(await screen.findByText('Oslo 3-seater sofa')).toBeInTheDocument();
      await expectNoViolations(c.container);
    });
  }

  it('asks for the Open state by default', async () => {
    const c = renderConsole({ path: '/issues', routes: ISSUES });
    await screen.findByText('Oslo 3-seater sofa');
    expect(c.to('GET', '/v1/ops/issues')[0]?.query.get('state')).toBe('Open');
  });

  it('resolves with a note', async () => {
    const c = renderConsole({
      path: '/issues',
      routes: {
        ...ISSUES,
        [`POST /v1/ops/issues/${ISSUE_ID}/resolve`]: {
          body: { id: ISSUE_ID, state: 'Resolved', lineState: 'Delivered' },
        },
      },
    });
    await c.user.click(await screen.findByRole('button', { name: 'Resolve' }));
    const dlg = await screen.findByRole('dialog');
    const ok = within(dlg).getByRole('button', { name: 'Confirm' });
    expect(ok).toBeDisabled();
    await c.user.type(within(dlg).getByLabelText(/Note/), 'Seller replaced the arm');
    await c.user.click(ok);
    await screen.findByText('Issue resolved.');
    expect(c.to('POST', `/v1/ops/issues/${ISSUE_ID}/resolve`)[0]?.body).toEqual({
      resolution: 'Resolved',
      note: 'Seller replaced the arm',
    });
  });

  it('a refund warns that it is irreversible before it can be confirmed', async () => {
    const c = renderConsole({
      path: '/issues',
      routes: {
        ...ISSUES,
        [`POST /v1/ops/issues/${ISSUE_ID}/resolve`]: {
          body: { id: ISSUE_ID, state: 'Refunded', lineState: 'Refunded' },
        },
      },
    });
    await c.user.click(await screen.findByRole('button', { name: 'Resolve' }));
    const dlg = await screen.findByRole('dialog');
    await c.user.selectOptions(within(dlg).getByLabelText('Outcome'), 'Refunded');
    expect(within(dlg).getByText(/cannot be undone/)).toBeInTheDocument();
    await c.user.type(within(dlg).getByLabelText(/Note/), 'Damaged on arrival');
    await c.user.click(within(dlg).getByRole('button', { name: 'Resolve' }));
    await screen.findByText('Issue resolved.');
    expect(c.to('POST', `/v1/ops/issues/${ISSUE_ID}/resolve`)[0]?.body).toMatchObject({
      resolution: 'Refunded',
    });
  });

  it('shows the API reason when a refund is refused, and keeps the dialog', async () => {
    const c = renderConsole({
      path: '/issues',
      routes: { ...ISSUES, [`POST /v1/ops/issues/${ISSUE_ID}/resolve`]: problem(409, 'conflict') },
    });
    await c.user.click(await screen.findByRole('button', { name: 'Resolve' }));
    const dlg = await screen.findByRole('dialog');
    await c.user.type(within(dlg).getByLabelText(/Note/), 'x');
    await c.user.click(within(dlg).getByRole('button', { name: 'Confirm' }));
    await vi.waitFor(() =>
      expect(dlg.querySelectorAll('[role=alert]:not(:empty)').length).toBeGreaterThan(0),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('finance has no Issues screen', async () => {
    renderConsole({ path: '/issues', role: 'ops_finance' });
    expect(
      await screen.findByRole('heading', { name: 'You do not have access to this' }),
    ).toBeInTheDocument();
  });
});
