import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { CheckoutScreen } from '../src/features/transact/CheckoutScreen.tsx';
import { CheckoutStartScreen } from '../src/features/transact/CheckoutStartScreen.tsx';
import { checkout, checkoutLine, ids } from './transact.fixtures.ts';
import { fakeApi, guestKv, problem, renderApp, router, userKv } from './support.tsx';

const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));
const serving = (c: ReturnType<typeof checkout>) =>
  fakeApi({ 'GET /v1/checkout/{id}': () => ({ body: c }) });

describe('checkout states', () => {
  it('Awaiting Seller Confirmation: says sellers are confirming, with how many, and offers no way to pay', async () => {
    await renderApp(<CheckoutScreen checkoutId={ids.checkout} />, {
      api: serving(
        checkout({
          state: 'Awaiting Seller Confirmation',
          pendingSellerConfirmations: 2,
          expiresAt: null,
          lines: [checkoutLine({ status: 'Awaiting Seller' })],
        }),
      ),
      kv: userKv(),
    });
    expect((await screen.findAllByText('Waiting for sellers')).length).toBe(2); // the state line and the banner title
    expect(screen.getByText(/2 seller\(s\) are confirming stock and price/)).toBeTruthy();
    expect(screen.getByText('Waiting for seller')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Continue to payment' })).toBeNull();
  });

  it('Awaiting Price Approval: shows old and new price, and approves exactly the total on screen', async () => {
    const changed = checkout({
      state: 'Awaiting Price Approval',
      lines: [
        checkoutLine({
          status: 'Price Changed',
          quotedUnitPrice: 450_000,
          currentUnitPrice: 470_000,
        }),
      ],
      total: 470_000,
      payable: 470_000,
    });
    const api = fakeApi({
      'GET /v1/checkout/{id}': () => ({ body: changed }),
      'POST /v1/checkout/{id}/approve-prices': () => ({
        body: checkout({ total: 470_000, payable: 470_000 }),
      }),
    });
    await renderApp(<CheckoutScreen checkoutId={ids.checkout} />, { api, kv: userKv() });
    expect(await screen.findByText('A price has changed')).toBeTruthy();
    expect(screen.getByText('New price')).toBeTruthy();
    await press('Approve new total');
    await waitFor(() =>
      expect(api.called('POST', `/v1/checkout/${ids.checkout}/approve-prices`)).toHaveLength(1),
    );
    expect(api.called('POST', `/v1/checkout/${ids.checkout}/approve-prices`)[0]?.body).toEqual({
      approvedTotal: 470_000,
    });
    // approval puts the screen into the server's next state: ready to pay
    expect(await screen.findByRole('button', { name: 'Continue to payment' })).toBeTruthy();
  });

  it('Ready to Pay: counts the 24 h window down, shows the deposit credit and what is payable', async () => {
    await renderApp(<CheckoutScreen checkoutId={ids.checkout} />, {
      api: serving(checkout({ depositCredit: 20_000, payable: 550_000 })),
      kv: userKv(),
    });
    expect(await screen.findByText(/Price held for 23:\d\d:\d\d/)).toBeTruthy();
    expect(screen.getByText('Viewing deposit credit')).toBeTruthy();
    expect(screen.getByText('Your viewing deposit is taken off what you pay.')).toBeTruthy();
    expect(screen.getByText('To pay')).toBeTruthy();
    await press('Continue to payment');
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/checkout/[id]/pay',
      params: { id: ids.checkout },
    });
  });

  it('Payment Requires Action: lets the buyer resume the bank step', async () => {
    await renderApp(<CheckoutScreen checkoutId={ids.checkout} />, {
      api: serving(checkout({ state: 'Payment Requires Action' })),
      kv: userKv(),
    });
    expect(
      await screen.findByText('Your bank needs one more step to approve this payment.'),
    ).toBeTruthy();
    await press('Resume payment');
    expect(router.push).toHaveBeenCalled();
  });

  it('Paid: goes to the order', async () => {
    await renderApp(<CheckoutScreen checkoutId={ids.checkout} />, {
      api: serving(checkout({ state: 'Paid', orderId: ids.order })),
      kv: userKv(),
    });
    await press('View order');
    expect(router.replace).toHaveBeenCalledWith(`/orders/${ids.order}`);
  });

  it('Rebuild Required: says what is wrong and routes back to the composition to start again', async () => {
    await renderApp(<CheckoutScreen checkoutId={ids.checkout} compositionId={ids.composition} />, {
      api: serving(
        checkout({
          state: 'Rebuild Required',
          lines: [checkoutLine({ status: 'Stock Unavailable' })],
        }),
      ),
      kv: userKv(),
    });
    expect(await screen.findByText('Some items need replacing')).toBeTruthy();
    expect(screen.getByText('Out of stock')).toBeTruthy();
    expect(screen.queryByText('To pay')).toBeNull();
    await press('Back to my room');
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/checkout/start',
      params: { compositionId: ids.composition },
    });
  });

  it('Expired: explains the window lapsed and offers a fresh start; without a composition it falls back to projects', async () => {
    await renderApp(<CheckoutScreen checkoutId={ids.checkout} />, {
      api: serving(checkout({ state: 'Expired', expiresAt: null })),
      kv: userKv(),
    });
    expect(await screen.findByText('This checkout expired')).toBeTruthy();
    await press('Start again');
    expect(router.replace).toHaveBeenCalledWith('/(tabs)/projects');
  });

  it('shows the server’s refusal in the user’s language, with the correlation id for support', async () => {
    const api = fakeApi({ 'GET /v1/checkout/{id}': () => problem(404, 'not_found') });
    await renderApp(<CheckoutScreen checkoutId={ids.checkout} />, { api, kv: userKv() });
    expect(await screen.findByText(/corr-1234/)).toBeTruthy();
  });
});

describe('starting checkout from a composition', () => {
  it('creates it once with one idempotency key and opens it', async () => {
    const api = fakeApi({
      'POST /v1/checkout': () => ({
        status: 201,
        body: checkout({ state: 'Awaiting Seller Confirmation', pendingSellerConfirmations: 1 }),
      }),
    });
    await renderApp(<CheckoutStartScreen compositionId={ids.composition} />, { api, kv: userKv() });
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    const calls = api.called('POST', '/v1/checkout');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      source: { kind: 'composition', compositionId: ids.composition },
    });
    expect(calls[0]?.headers['idempotency-key']).toMatch(/^[0-9a-f-]{16,}$/);
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/checkout/[id]',
      params: { id: ids.checkout, compositionId: ids.composition },
    });
  });

  it('passes the completed viewing along so its deposit is credited', async () => {
    const api = fakeApi({ 'POST /v1/checkout': () => ({ status: 201, body: checkout() }) });
    await renderApp(
      <CheckoutStartScreen compositionId={ids.composition} viewingId={ids.viewing} />,
      { api, kv: userKv() },
    );
    await waitFor(() => expect(api.called('POST', '/v1/checkout')).toHaveLength(1));
    expect(api.called('POST', '/v1/checkout')[0]?.body).toMatchObject({
      viewingRequestId: ids.viewing,
    });
  });

  it('sends a guest to sign in and remembers to come back to this exact step', async () => {
    const api = fakeApi({ 'POST /v1/checkout': () => problem(403, 'registration_required') });
    const kv = guestKv();
    await renderApp(<CheckoutStartScreen compositionId={ids.composition} />, { api, kv });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/sign-in'));
    const stored = await kv.get('aidooi.pending-action.v1');
    expect(stored).toContain(`/checkout/start?compositionId=${ids.composition}`);
    expect(router.replace).not.toHaveBeenCalled();
  });
});
