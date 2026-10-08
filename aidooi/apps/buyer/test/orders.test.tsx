import { StyleSheet } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { IssueScreen } from '../src/features/transact/IssueScreen.tsx';
import { OrderScreen } from '../src/features/transact/OrderScreen.tsx';
import { OrdersScreen } from '../src/features/transact/OrdersScreen.tsx';
import { ids, order, orderLine } from './transact.fixtures.ts';
import { fakeApi, guestKv, problem, renderApp, router, userKv } from './support.tsx';

const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));
const orderPath = `/v1/orders/${ids.order}`;

describe('orders list', () => {
  it('shows one row per order with a single total and status, however many sellers fulfil it', async () => {
    const api = fakeApi({
      'GET /v1/orders': () => ({
        body: {
          items: [order(), order({ id: ids.checkout, status: 'Completed', lines: [orderLine()] })],
          nextCursor: null,
        },
      }),
    });
    await renderApp(<OrdersScreen />, { api, kv: userKv() });
    expect(await screen.findByText('2 items')).toBeTruthy();
    expect(screen.getByText('1 items')).toBeTruthy();
    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.getByText('Completed')).toBeTruthy();
    await fireEvent.press(screen.getAllByRole('button')[0]!);
    expect(router.push).toHaveBeenCalledWith(`/orders/${ids.order}`);
  });

  it('pages with the server’s cursor', async () => {
    const api = fakeApi({
      'GET /v1/orders': (c) =>
        c.search.includes('cursor=c2')
          ? { body: { items: [order({ id: ids.checkout })], nextCursor: null } }
          : { body: { items: [order()], nextCursor: 'c2' } },
    });
    await renderApp(<OrdersScreen />, { api, kv: userKv() });
    await screen.findByRole('button', { name: 'Show more' });
    await press('Show more');
    await waitFor(() => expect(api.called('GET', '/v1/orders')).toHaveLength(2));
    expect(api.called('GET', '/v1/orders')[1]?.search).toContain('cursor=c2');
    expect(await screen.findAllByText('2 items')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('is welcoming when empty and asks a guest to sign in', async () => {
    await renderApp(<OrdersScreen />, {
      api: fakeApi({ 'GET /v1/orders': () => ({ body: { items: [], nextCursor: null } }) }),
      kv: userKv(),
    });
    expect(await screen.findByText('No orders yet')).toBeTruthy();
  });

  it('a guest is invited to sign in rather than shown an error', async () => {
    const api = fakeApi({ 'GET /v1/orders': () => problem(403, 'registration_required') });
    await renderApp(<OrdersScreen />, { api, kv: guestKv() });
    expect(await screen.findByText('Sign in to continue')).toBeTruthy();
  });
});

describe('order detail', () => {
  const serving = (o = order(), extra: Parameters<typeof fakeApi>[0] = {}) =>
    fakeApi({ 'GET /v1/orders/{id}': () => ({ body: o }), ...extra });

  it('is ONE order: grouped per-item status, ETA, payment with deposit credit, and no seller split', async () => {
    await renderApp(<OrderScreen orderId={ids.order} />, { api: serving(), kv: userKv() });
    expect(await screen.findByText('Oslo Sofa ×1')).toBeTruthy();
    expect(screen.getByText('Fjord Table ×1')).toBeTruthy();
    expect(screen.getByText('Delivered')).toBeTruthy();
    expect(screen.getByText('Being prepared')).toBeTruthy();
    expect(screen.getByText(/Expected by/)).toBeTruthy();
    expect(screen.getByText('Viewing deposit credit')).toBeTruthy();
    expect(screen.getByText('Payment status: Captured')).toBeTruthy();
    expect(screen.queryByText(/Marina Living/)).toBeNull();
    expect(screen.getByText(/each seller’s after-sales terms/)).toBeTruthy();
  });

  it('thanks the buyer right after paying', async () => {
    await renderApp(<OrderScreen orderId={ids.order} placed />, { api: serving(), kv: userKv() });
    expect(await screen.findByText('Thank you')).toBeTruthy();
  });

  it('confirming receipt takes two deliberate taps and then refreshes the order', async () => {
    const received = order({
      lines: [
        orderLine({ state: 'Receipt Confirmed', receiptConfirmedAt: '2026-10-10T10:00:00.000Z' }),
      ],
    });
    let confirmed = false;
    const api = fakeApi({
      'GET /v1/orders/{id}': () => ({
        body: confirmed ? received : order({ lines: [orderLine()] }),
      }),
      'POST /v1/orders/{id}/lines/{id}/confirm-receipt': () => {
        confirmed = true;
        return { body: { ok: true } };
      },
    });
    await renderApp(<OrderScreen orderId={ids.order} />, { api, kv: userKv() });
    await screen.findByText('Oslo Sofa ×1');
    await press('Confirm receipt');
    expect(api.called('POST', orderPath)).toHaveLength(0); // the first tap only asks
    expect(
      screen.getByText('Only confirm once the item is with you and in good condition.'),
    ).toBeTruthy();
    await press('Yes, I received it');
    expect(await screen.findByText('Received')).toBeTruthy();
    expect(api.called('POST', `${orderPath}/lines/${ids.line}/confirm-receipt`)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Confirm receipt' })).toBeNull();
  });

  it('offers receipt only for delivered items, and reporting only while an item is still open', async () => {
    const o = order({
      lines: [
        orderLine({ state: 'Dispatched', deliveredAt: null }),
        orderLine({ id: ids.line2, state: 'Cancelled', deliveredAt: null }),
      ],
    });
    await renderApp(<OrderScreen orderId={ids.order} />, { api: serving(o), kv: userKv() });
    await screen.findAllByText('Oslo Sofa ×1');
    expect(screen.queryByRole('button', { name: 'Confirm receipt' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Report a problem' })).toHaveLength(1);
  });

  it('opens the issue form for the item', async () => {
    await renderApp(<OrderScreen orderId={ids.order} />, { api: serving(), kv: userKv() });
    await screen.findByText('Oslo Sofa ×1');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Report a problem' })[0]!);
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/orders/[id]/issue',
      params: { id: ids.order, lineId: ids.line },
    });
  });

  it('shows an item’s open issue and its state', async () => {
    const o = order({
      status: 'Issue Reported',
      lines: [
        orderLine({ openIssues: [{ id: ids.stop, flag: 'Damaged', state: 'Partner Handling' }] }),
      ],
    });
    await renderApp(<OrderScreen orderId={ids.order} />, { api: serving(o), kv: userKv() });
    expect(await screen.findByText('It arrived damaged · With the seller')).toBeTruthy();
    expect(screen.getByText('Issue reported')).toBeTruthy();
  });

  it('is right-to-left and in Arabic when the app is', async () => {
    await renderApp(<OrderScreen orderId={ids.order} />, {
      api: serving(),
      kv: userKv({ 'aidooi.locale.v1': 'ar' }),
    });
    const title = await screen.findByText('الطلب');
    expect(StyleSheet.flatten(title.props.style).writingDirection).toBe('rtl');
    expect(screen.getByText('تم التسليم')).toBeTruthy();
    expect(screen.getByText('الموعد المتوقع', { exact: false })).toBeTruthy();
  });
});

describe('reporting an issue', () => {
  it('lists every flag the contract allows, with plain help text', async () => {
    await renderApp(<IssueScreen orderId={ids.order} lineId={ids.line} />, { kv: userKv() });
    for (const label of [
      'It is late',
      'Delivery failed',
      'It arrived damaged',
      'Something is missing',
      'I want to cancel',
      'I want to return it',
      'Something else is wrong',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    expect(screen.getByText('Part or all of the item is damaged.')).toBeTruthy();
  });

  it('will not send without choosing what happened', async () => {
    const api = fakeApi({});
    await renderApp(<IssueScreen orderId={ids.order} lineId={ids.line} />, { api, kv: userKv() });
    await press('Send report');
    expect(await screen.findByText('Choose one')).toBeTruthy();
    expect(api.calls).toHaveLength(0);
  });

  it('sends the flag and note, tells the buyer, and goes back', async () => {
    const api = fakeApi({
      'POST /v1/orders/{id}/lines/{id}/issues': () => ({
        status: 201,
        body: {
          id: ids.stop,
          orderLineId: ids.line,
          flag: 'Damaged',
          state: 'Open',
          note: 'Leg cracked',
          raisedAt: '2026-10-10T10:00:00.000Z',
          resolvedAt: null,
          resolutionNote: null,
          productName: 'Oslo Sofa',
        },
      }),
      'GET /v1/orders/{id}': () => ({ body: order() }),
    });
    await renderApp(<IssueScreen orderId={ids.order} lineId={ids.line} />, { api, kv: userKv() });
    await press('It arrived damaged');
    await fireEvent.changeText(screen.getByLabelText('More detail'), '  Leg cracked ');
    await press('Send report');
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(api.called('POST', `${orderPath}/lines/${ids.line}/issues`)[0]?.body).toEqual({
      flag: 'Damaged',
      note: 'Leg cracked',
    });
    expect(await screen.findByText('Report sent. We will keep you updated.')).toBeTruthy();
  });

  it('shows the server’s refusal and keeps what was written', async () => {
    const api = fakeApi({
      'POST /v1/orders/{id}/lines/{id}/issues': () => problem(409, 'issue_already_open'),
    });
    await renderApp(<IssueScreen orderId={ids.order} lineId={ids.line} />, { api, kv: userKv() });
    await press('It is late');
    await fireEvent.changeText(screen.getByLabelText('More detail'), 'Still waiting');
    await press('Send report');
    expect(await screen.findByText(/corr-1234/)).toBeTruthy();
    expect(screen.getByDisplayValue('Still waiting')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('stops the note at the limit the server enforces', async () => {
    await renderApp(<IssueScreen orderId={ids.order} lineId={ids.line} />, { kv: userKv() });
    await fireEvent.changeText(screen.getByLabelText('More detail'), 'x'.repeat(1200));
    expect(screen.getByDisplayValue('x'.repeat(1000))).toBeTruthy();
    expect(screen.getByText('0 characters left')).toBeTruthy();
  });
});
