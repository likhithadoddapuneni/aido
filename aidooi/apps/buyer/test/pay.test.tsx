import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type * as PaymentModule from '../src/features/transact/payment/index.ts';
import { PayScreen } from '../src/features/transact/PayScreen.tsx';
import { address, checkout, ids, me } from './transact.fixtures.ts';
import {
  fakeApi,
  problem,
  renderApp,
  router,
  userKv,
  type Reply,
  type RecordedCall,
} from './support.tsx';

const browser = (globalThis as unknown as { __mockBrowser: { openBrowserAsync: jest.Mock } })
  .__mockBrowser;
const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));
const payPath = `/v1/checkout/${ids.checkout}/pay`;

beforeAll(() => {
  process.env['EXPO_PUBLIC_ENABLE_MOCK_PAYMENTS'] = 'true';
});
afterAll(() => {
  delete process.env['EXPO_PUBLIC_ENABLE_MOCK_PAYMENTS'];
});

const PAID: Reply = {
  body: { status: 'paid', orderId: ids.order, paid: 570_000, depositCredit: 0 },
};

/** The server's side of the screen; `pay` scripts successive answers to POST /pay. */
function server(
  pay: (call: RecordedCall, n: number) => Reply,
  extra: Parameters<typeof fakeApi>[0] = {},
) {
  let n = 0;
  return fakeApi({
    'GET /v1/checkout/{id}': () => ({ body: checkout() }),
    'GET /v1/me': () => ({ body: me() }),
    'GET /v1/me/addresses': () => ({ body: [address()] }),
    'POST /v1/checkout/{id}/pay': (c) => pay(c, ++n),
    'POST /v1/me/addresses': () => ({ status: 201, body: address() }),
    ...extra,
  });
}
const keysOf = (api: ReturnType<typeof fakeApi>) =>
  api.called('POST', payPath).map((c) => c.headers['idempotency-key']);

async function openPay(api: ReturnType<typeof fakeApi>) {
  await renderApp(<PayScreen checkoutId={ids.checkout} />, { api, kv: userKv() });
  // prefilled from the profile and the default address: the buyer only has to choose to pay
  expect(await screen.findByDisplayValue('Amal Hassan')).toBeTruthy();
  expect(await screen.findByDisplayValue('Villa 12, Street 4, Al Barsha')).toBeTruthy();
}

describe('paying', () => {
  it('sends the provider token and the delivery details, with an idempotency key, and lands on the order', async () => {
    const api = server(() => PAID);
    await openPay(api);
    await press('Pay now');
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/orders/[id]',
        params: { id: ids.order, placed: '1' },
      }),
    );
    const call = api.called('POST', payPath)[0]!;
    expect(call.body).toMatchObject({
      paymentToken: 'tok_ok',
      delivery: {
        recipientName: 'Amal Hassan',
        phone: '+971501234567',
        line1: 'Villa 12, Street 4, Al Barsha',
        emirate: 'Dubai',
      },
    });
    expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f-]{16,}$/);
  });

  it('checks the delivery form locally and does not call the server until it is valid', async () => {
    const api = server(() => PAID, { 'GET /v1/me/addresses': () => ({ body: [] }) });
    await renderApp(<PayScreen checkoutId={ids.checkout} />, { api, kv: userKv() });
    await screen.findByDisplayValue('Amal Hassan');
    await press('Pay now');
    expect((await screen.findAllByText('Please check this value.')).length).toBeGreaterThan(0);
    expect(api.called('POST', payPath)).toHaveLength(0);
  });

  it('a declined card ends that attempt; the next card is a NEW payment with a NEW key', async () => {
    const api = server((_c, n) => (n === 1 ? problem(402, 'payment_declined') : PAID));
    await openPay(api);
    await fireEvent.press(screen.getByText('Declined'));
    await press('Pay now');
    expect(
      await screen.findByText('Your payment was not accepted.', { exact: false }),
    ).toBeTruthy();
    expect(screen.getByText('Try a different card.')).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText('Approved'));
    await press('Pay now');
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    const [first, second] = keysOf(api);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(
      api.called('POST', payPath).map((c) => (c.body as { paymentToken: string }).paymentToken),
    ).toEqual(['tok_decline', 'tok_ok']);
  });

  it('a flaky connection retries with the IDENTICAL idempotency key, so one tap is one charge', async () => {
    const api = server((_c, n) => (n === 1 ? problem(503, 'payment_provider_unavailable') : PAID));
    await openPay(api);
    await fireEvent.press(screen.getByText('Flaky once'));
    await press('Pay now');
    await waitFor(() => expect(router.replace).toHaveBeenCalled(), { timeout: 3000 });
    const keys = keysOf(api);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('when retries run out, the buyer can tap retry and it still carries the same key', async () => {
    const api = server((_c, n) => (n <= 3 ? problem(503, 'payment_provider_unavailable') : PAID));
    await openPay(api);
    await press('Pay now');
    expect(
      await screen.findByText(
        'Trying again is safe: you will only be charged once.',
        {},
        { timeout: 4000 },
      ),
    ).toBeTruthy();
    expect(keysOf(api)).toHaveLength(3);
    await press('Try again');
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(new Set(keysOf(api)).size).toBe(1);
    expect(keysOf(api)).toHaveLength(4);
  });

  it('3-D Secure: opens the bank page, then asks the server until it knows, and goes to the order', async () => {
    const api = server(
      () => ({
        status: 202,
        body: {
          status: 'requires_action',
          paymentId: ids.order,
          actionUrl: 'https://bank.example/3ds',
        },
      }),
      {
        'GET /v1/checkout/{id}': () => ({ body: checkout({ state: 'Paid', orderId: ids.order }) }),
      },
    );
    await renderApp(<PayScreen checkoutId={ids.checkout} />, { api, kv: userKv() });
    // the checkout is already Paid in this script, but the screen only renders the form from the loaded state
    await screen.findByDisplayValue('Amal Hassan');
    await fireEvent.press(screen.getByText('Bank approval'));
    await press('Pay now');
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/orders/[id]',
        params: { id: ids.order, placed: '1' },
      }),
    );
    expect(browser.openBrowserAsync).toHaveBeenCalledWith('https://bank.example/3ds');
    expect(api.called('POST', payPath)).toHaveLength(1);
  });

  it('3-D Secure refused at the bank: the attempt is over and the buyer is told so', async () => {
    const api = server(
      () => ({
        status: 202,
        body: {
          status: 'requires_action',
          paymentId: ids.order,
          actionUrl: 'https://bank.example/3ds',
        },
      }),
      {
        'GET /v1/checkout/{id}': () => ({ body: checkout({ state: 'Ready to Pay' }) }),
      },
    );
    await openPay(api);
    await fireEvent.press(screen.getByText('Bank approval'));
    await press('Pay now');
    expect(await screen.findByText('Try a different card.')).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('409 price changed: nothing is charged and the buyer is sent back to review the new total', async () => {
    const api = server(() => problem(409, 'price_approval_required'));
    await openPay(api);
    await press('Pay now');
    expect(await screen.findByText('The price changed')).toBeTruthy();
    await press('Review');
    expect(router.replace).toHaveBeenCalledWith(`/checkout/${ids.checkout}`);
  });

  it('409 payment in progress: waits and checks rather than paying twice, then shows the order', async () => {
    const api = server(() => problem(409, 'payment_in_progress'), {
      'GET /v1/checkout/{id}': () => ({ body: checkout({ state: 'Paid', orderId: ids.order }) }),
    });
    await openPay(api);
    await press('Pay now');
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/orders/[id]',
        params: { id: ids.order, placed: '1' },
      }),
    );
    expect(api.called('POST', payPath)).toHaveLength(1);
  });

  it('saves the address afterwards when asked, as the default if it is the first', async () => {
    const api = server(() => PAID, { 'GET /v1/me/addresses': () => ({ body: [] }) });
    await renderApp(<PayScreen checkoutId={ids.checkout} />, { api, kv: userKv() });
    await screen.findByDisplayValue('Amal Hassan');
    await fireEvent.changeText(screen.getByLabelText('Address'), 'Flat 3, Marina Tower');
    await fireEvent.press(screen.getByText('Dubai'));
    await fireEvent.press(screen.getByText('Save this address'));
    await press('Pay now');
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(api.called('POST', '/v1/me/addresses')[0]?.body).toMatchObject({
      line1: 'Flat 3, Marina Tower',
      emirate: 'Dubai',
      isDefault: true,
    });
  });
});

describe('production has no mock payments', () => {
  /** Run `fn` as a build with the given `__DEV__` and opt-in flag, on a fresh copy of the payment module. */
  async function asBuild<T>(
    dev: boolean,
    flag: string | undefined,
    fn: (mod: typeof PaymentModule) => T | Promise<T>,
  ): Promise<T> {
    const g = globalThis as unknown as { __DEV__: boolean };
    const before = { dev: g.__DEV__, flag: process.env['EXPO_PUBLIC_ENABLE_MOCK_PAYMENTS'] };
    g.__DEV__ = dev;
    if (flag === undefined) delete process.env['EXPO_PUBLIC_ENABLE_MOCK_PAYMENTS'];
    else process.env['EXPO_PUBLIC_ENABLE_MOCK_PAYMENTS'] = flag;
    try {
      let mod!: typeof PaymentModule;
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- a fresh module registry is the point
        mod = require('../src/features/transact/payment/index.ts');
      });
      return await fn(mod);
    } finally {
      g.__DEV__ = before.dev;
      if (before.flag === undefined) delete process.env['EXPO_PUBLIC_ENABLE_MOCK_PAYMENTS'];
      else process.env['EXPO_PUBLIC_ENABLE_MOCK_PAYMENTS'] = before.flag;
    }
  }

  it('a production build never loads the mock, even if the flag is set', async () => {
    await asBuild(false, 'true', async (mod) => {
      expect(mod.loadDemoPayments()).toBeNull();
      await expect(mod.resolvePaymentSheet().getPaymentToken()).rejects.toBeInstanceOf(
        mod.PaymentNotConfigured,
      );
    });
  });

  it('a development build without the explicit flag does not either', async () => {
    await asBuild(true, undefined, (mod) => expect(mod.loadDemoPayments()).toBeNull());
    await asBuild(true, 'false', (mod) => expect(mod.loadDemoPayments()).toBeNull());
  });

  it('only a development build with the flag gets the demo tokens', async () => {
    await asBuild(true, 'true', (mod) =>
      expect(mod.loadDemoPayments()?.scenarios.map((s) => s.token)).toContain('tok_decline'),
    );
  });

  it('the pay screen then says plainly that payments are not switched on', async () => {
    const g = globalThis as unknown as { __DEV__: boolean };
    const before = g.__DEV__;
    g.__DEV__ = false;
    try {
      const api = server(() => PAID);
      await renderApp(<PayScreen checkoutId={ids.checkout} />, { api, kv: userKv() });
      await screen.findByDisplayValue('Amal Hassan');
      await screen.findByDisplayValue('Villa 12, Street 4, Al Barsha');
      expect(screen.queryByText('Test card (development only)')).toBeNull();
      await press('Pay now');
      expect(
        await screen.findByText('Card payments are not switched on in this build yet.'),
      ).toBeTruthy();
      expect(api.called('POST', payPath)).toHaveLength(0);
    } finally {
      g.__DEV__ = before;
    }
  });
});
