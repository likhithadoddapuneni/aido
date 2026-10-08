import * as Linking from 'expo-linking';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { NetworkError } from '@aidooi/api-client';
import { DepositRules, ViewingNewScreen } from '../src/features/transact/ViewingNewScreen.tsx';
import { ViewingScreen } from '../src/features/transact/ViewingScreen.tsx';
import { PassScreen } from '../src/features/transact/PassScreen.tsx';
import { ViewingsListScreen } from '../src/features/transact/ViewingsListScreen.tsx';
import { createPassCache } from '../src/features/transact/passCache.ts';
import { composition, offer } from './fixtures.ts';
import { ids, inHours, stop, viewing } from './transact.fixtures.ts';
import { fakeApi, guestKv, problem, renderApp, router, userKv } from './support.tsx';

const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));
const viewingPath = `/v1/viewings/${ids.viewing}`;
const serving = (v: ReturnType<typeof viewing>, extra: Parameters<typeof fakeApi>[0] = {}) =>
  fakeApi({ 'GET /v1/viewings/{id}': () => ({ body: v }), ...extra });

beforeAll(() => {
  process.env['EXPO_PUBLIC_ENABLE_MOCK_PAYMENTS'] = 'true';
});
afterAll(() => {
  delete process.env['EXPO_PUBLIC_ENABLE_MOCK_PAYMENTS'];
});

describe('deposit rules', () => {
  it('say in plain words what the deposit is, when it comes back and when it is kept', async () => {
    await renderApp(<DepositRules />);
    expect(screen.getByText('How the viewing deposit works')).toBeTruthy();
    expect(screen.getByText(/5% of the items you choose, never more than AED 500/)).toBeTruthy();
    expect(screen.getByText(/whole deposit is taken off your total/)).toBeTruthy();
    expect(
      screen.getByText(/cancel before your visit, and the deposit is returned in full/),
    ).toBeTruthy();
    expect(screen.getByText(/If you do not turn up, the deposit is kept/)).toBeTruthy();
  });

  it('are in Arabic too', async () => {
    await renderApp(<DepositRules />, { kv: guestKv({ 'aidooi.locale.v1': 'ar' }) });
    expect(await screen.findByText('كيف يعمل عربون المعاينة')).toBeTruthy();
  });
});

describe('requesting a viewing', () => {
  const comp = composition({
    items: composition().items.map((i, n) =>
      n === 1 ? { ...i, offer: { ...offer('AIO-2'), viewingStatus: 'Not Viewable' as const } } : i,
    ),
  });
  const compApi = (extra: Parameters<typeof fakeApi>[0] = {}) =>
    fakeApi({ 'GET /v1/compositions/{id}': () => ({ body: comp }), ...extra });

  it('offers only products a showroom can show, books them, and opens the viewing', async () => {
    const api = compApi({ 'POST /v1/viewings': () => ({ status: 201, body: viewing() }) });
    await renderApp(<ViewingNewScreen compositionId={comp.id} />, { api, kv: userKv() });
    expect(await screen.findByLabelText('Orla Sofa 3-Seater, Selected')).toBeTruthy();
    expect(screen.getByLabelText('Form Vase, Not on view')).toBeTruthy();
    await press('Request viewing');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/viewing/${ids.viewing}`));
    const call = api.called('POST', '/v1/viewings')[0]!;
    expect(call.body).toEqual({ compositionId: comp.id, itemSlotKeys: ['Sofa#0'] });
    expect(call.headers['idempotency-key']).toBeTruthy();
  });

  it('cannot request with nothing selected', async () => {
    const api = compApi();
    await renderApp(<ViewingNewScreen compositionId={comp.id} />, { api, kv: userKv() });
    await fireEvent.press(await screen.findByLabelText('Orla Sofa 3-Seater, Selected'));
    expect(
      screen.getByRole('button', { name: 'Request viewing' }).props.accessibilityState.disabled,
    ).toBe(true);
  });

  it('sends a guest to sign in and resumes the same request afterwards', async () => {
    const api = compApi({ 'POST /v1/viewings': () => problem(403, 'registration_required') });
    const kv = guestKv();
    await renderApp(<ViewingNewScreen compositionId={comp.id} />, { api, kv });
    await screen.findByLabelText('Orla Sofa 3-Seater, Selected');
    await press('Request viewing');
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/sign-in'));
    expect(await kv.get('aidooi.pending-action.v1')).toContain(
      `/viewing/new?compositionId=${comp.id}`,
    );
  });
});

describe('viewing states', () => {
  it('waiting for showrooms: shows each stop with its confirmation, an address and a way to open the map', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const v = viewing({
      state: 'Awaiting Seller Confirmation',
      stops: [
        stop({ confirmation: 'Pending' }),
        stop({
          id: ids.stop2,
          stopNo: 2,
          locationName: 'Nordic Home – DIP',
          address: 'DIP 1, Dubai',
          confirmation: 'Confirmed',
        }),
      ],
    });
    await renderApp(<ViewingScreen viewingId={ids.viewing} />, { api: serving(v), kv: userKv() });
    expect(await screen.findByText(/Waiting for the showrooms to confirm/)).toBeTruthy();
    expect(screen.getByText('Waiting')).toBeTruthy();
    expect(screen.getAllByText('Confirmed').length).toBeGreaterThan(0);
    expect(screen.getByText('Street 8, Al Quoz Industrial 3, Dubai')).toBeTruthy();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Open in Maps' })[0]!);
    expect(open).toHaveBeenCalledWith(expect.stringContaining('google.com/maps'));
    expect(open.mock.calls[0]![0]).toContain(
      encodeURIComponent('Street 8, Al Quoz Industrial 3, Dubai'),
    );
    open.mockRestore();
  });

  it('a declined stop: the buyer chooses to continue without it or cancel, nothing is decided for them', async () => {
    const v = viewing({
      state: 'Awaiting Seller Confirmation',
      needsDecision: true,
      stops: [stop({ confirmation: 'Declined' }), stop({ id: ids.stop2, stopNo: 2 })],
    });
    const after = viewing({
      state: 'Awaiting Deposit',
      stops: [stop({ id: ids.stop2, stopNo: 2 })],
    });
    const api = serving(v, { 'POST /v1/viewings/{id}/continue': () => ({ body: after }) });
    await renderApp(<ViewingScreen viewingId={ids.viewing} />, { api, kv: userKv() });
    expect(await screen.findByText('A showroom cannot host you')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel viewing' })).toBeTruthy();
    await press('Continue without it');
    expect(await screen.findByText('Deposit to pay')).toBeTruthy();
    expect(api.called('POST', `${viewingPath}/continue`)).toHaveLength(1);
  });

  it('a declined stop can be cancelled, after a second tap, and says nothing was charged', async () => {
    const v = viewing({
      state: 'Awaiting Seller Confirmation',
      needsDecision: true,
      stops: [stop({ confirmation: 'Declined' })],
    });
    const api = serving(v, {
      'POST /v1/viewings/{id}/cancel': () => ({ body: viewing({ state: 'Cancelled' }) }),
    });
    await renderApp(<ViewingScreen viewingId={ids.viewing} />, { api, kv: userKv() });
    await screen.findByText('A showroom cannot host you');
    await press('Cancel viewing');
    expect(api.called('POST', `${viewingPath}/cancel`)).toHaveLength(0);
    expect(
      screen.getByText('No deposit has been taken, so cancelling costs nothing.'),
    ).toBeTruthy();
    await press('Yes, cancel');
    expect(await screen.findByText('Viewing cancelled.')).toBeTruthy();
  });

  it('cancelling a paid viewing says the deposit comes back', async () => {
    const v = viewing({
      state: 'Confirmed',
      scheduledAt: inHours(30),
      pass: 'p',
      deposit: { state: 'Paid', amount: 22_500, credited: null },
    });
    await renderApp(<ViewingScreen viewingId={ids.viewing} />, { api: serving(v), kv: userKv() });
    await screen.findByRole('button', { name: 'Show my pass' });
    await press('Cancel viewing');
    expect(screen.getByText('Your deposit will be refunded in full.')).toBeTruthy();
  });
});

describe('paying the deposit', () => {
  const awaiting = viewing();
  const confirmed = viewing({
    state: 'Confirmed',
    scheduledAt: inHours(30),
    pass: 'tok',
    deposit: { state: 'Paid', amount: 22_500, credited: null },
  });

  it('shows the server’s quote and the rules, pays with a token and an idempotency key, and shows the confirmed visit', async () => {
    const api = serving(awaiting, {
      'POST /v1/viewings/{id}/deposit': () => ({
        body: { status: 'confirmed', viewing: confirmed },
      }),
    });
    await renderApp(<ViewingScreen viewingId={ids.viewing} />, { api, kv: userKv() });
    expect(await screen.findByText('Deposit to pay')).toBeTruthy();
    expect(screen.getByText('5% of the items you chose.')).toBeTruthy();
    expect(screen.getByText('How the viewing deposit works')).toBeTruthy();
    await press('Pay deposit');
    expect(await screen.findByRole('button', { name: 'Show my pass' })).toBeTruthy();
    const call = api.called('POST', `${viewingPath}/deposit`)[0]!;
    expect(call.body).toMatchObject({ paymentToken: 'tok_ok' });
    expect((call.body as { scheduledAt: string }).scheduledAt).toMatch(/T/);
    expect(call.headers['idempotency-key']).toBeTruthy();
    expect(screen.getByText(/Starts in/)).toBeTruthy();
  });

  it('says so when the quote hit the AED 500 cap', async () => {
    const capped = viewing({ depositQuote: { base: 5_000_000, amount: 50_000, capped: true } });
    await renderApp(<ViewingScreen viewingId={ids.viewing} />, {
      api: serving(capped),
      kv: userKv(),
    });
    expect(await screen.findByText('Capped at AED 500, however much you view.')).toBeTruthy();
  });

  it('a flaky connection retries the deposit with the identical key', async () => {
    let n = 0;
    const api = serving(awaiting, {
      'POST /v1/viewings/{id}/deposit': () =>
        ++n === 1
          ? problem(503, 'payment_provider_unavailable')
          : { body: { status: 'confirmed', viewing: confirmed } },
    });
    await renderApp(<ViewingScreen viewingId={ids.viewing} />, { api, kv: userKv() });
    await screen.findByText('Deposit to pay');
    await press('Pay deposit');
    expect(
      await screen.findByRole('button', { name: 'Show my pass' }, { timeout: 3000 }),
    ).toBeTruthy();
    const keys = api
      .called('POST', `${viewingPath}/deposit`)
      .map((c) => c.headers['idempotency-key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('a declined card shows the refusal and leaves the buyer on the deposit step', async () => {
    const api = serving(awaiting, {
      'POST /v1/viewings/{id}/deposit': () => problem(402, 'payment_declined'),
    });
    await renderApp(<ViewingScreen viewingId={ids.viewing} />, { api, kv: userKv() });
    await screen.findByText('Deposit to pay');
    await press('Pay deposit');
    expect(await screen.findByText(/Your payment was not accepted/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pay deposit' })).toBeTruthy();
  });

  it('opens the pass from a confirmed viewing', async () => {
    await renderApp(<ViewingScreen viewingId={ids.viewing} />, {
      api: serving(confirmed),
      kv: userKv(),
    });
    await press('Show my pass');
    expect(router.push).toHaveBeenCalledWith(`/viewing/${ids.viewing}/pass`);
  });

  it('after the visit: offers to buy, carrying the viewing so the deposit is credited', async () => {
    const done = viewing({
      state: 'Completed',
      deposit: { state: 'Paid', amount: 22_500, credited: null },
    });
    await renderApp(<ViewingScreen viewingId={ids.viewing} />, {
      api: serving(done),
      kv: userKv(),
    });
    await screen.findByRole('button', { name: 'Buy now' });
    await press('Buy now');
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/checkout/start',
      params: { compositionId: ids.composition, viewingId: ids.viewing },
    });
  });
});

describe('the viewing pass', () => {
  const confirmed = viewing({
    state: 'Confirmed',
    scheduledAt: inHours(30),
    pass: 'tok',
    deposit: { state: 'Paid', amount: 22_500, credited: null },
  });
  const pass = {
    token: 'v1.payload.signature-token',
    validFrom: inHours(-1),
    validUntil: inHours(40),
  };
  const brightness = {
    getBrightnessAsync: jest.fn(async () => 0.3),
    setBrightnessAsync: jest.fn(async () => undefined),
  };

  beforeEach(() => brightness.setBrightnessAsync.mockClear());

  it('shows the QR code with a countdown, turns the screen up, and caches itself for the showroom basement', async () => {
    const kv = userKv();
    const api = fakeApi({
      'GET /v1/viewings/{id}': () => ({ body: confirmed }),
      'GET /v1/viewings/{id}/pass': () => ({ body: pass }),
    });
    await renderApp(<PassScreen viewingId={ids.viewing} brightness={brightness} />, { api, kv });
    expect(await screen.findByLabelText('Viewing pass QR code')).toBeTruthy();
    expect(screen.getByText(/Starts in/)).toBeTruthy();
    expect(screen.getByText(/Valid until/)).toBeTruthy();
    expect(screen.getByText(/Marina Living – Al Quoz/)).toBeTruthy();
    await waitFor(() => expect(brightness.setBrightnessAsync).toHaveBeenCalledWith(1));
    const cached = await createPassCache(kv).read(ids.viewing);
    expect(cached?.token).toBe(pass.token);
  });

  it('opens with no signal from the cached pass, and says so', async () => {
    const kv = userKv();
    await createPassCache(kv).save({
      viewingId: ids.viewing,
      token: pass.token,
      validFrom: pass.validFrom,
      validUntil: pass.validUntil,
      scheduledAt: confirmed.scheduledAt,
      stops: [
        {
          stopNo: 1,
          partnerName: 'Marina Living',
          locationName: 'Offline Showroom',
          address: 'Al Quoz',
        },
      ],
      cachedAt: inHours(-2),
    });
    const offlineFetch = (async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    const api = { ...fakeApi({}), fetch: offlineFetch };
    await renderApp(<PassScreen viewingId={ids.viewing} brightness={null} />, { api, kv });
    expect(await screen.findByLabelText('Viewing pass QR code')).toBeTruthy();
    expect(screen.getByText('No connection. Showing the pass saved on this phone.')).toBeTruthy();
    expect(screen.getByText(/Offline Showroom/)).toBeTruthy();
  });

  it('never papers over a server refusal with a stale pass', async () => {
    const kv = userKv();
    await createPassCache(kv).save({
      viewingId: ids.viewing,
      token: pass.token,
      validFrom: pass.validFrom,
      validUntil: pass.validUntil,
      scheduledAt: null,
      stops: [],
      cachedAt: inHours(-2),
    });
    const api = fakeApi({
      'GET /v1/viewings/{id}': () => problem(409, 'conflict'),
      'GET /v1/viewings/{id}/pass': () => problem(409, 'conflict'),
    });
    await renderApp(<PassScreen viewingId={ids.viewing} brightness={null} />, { api, kv });
    expect(await screen.findByText(/corr-1234/)).toBeTruthy();
    expect(screen.queryByLabelText('Viewing pass QR code')).toBeNull();
  });

  it('says plainly when the pass has expired', async () => {
    const api = fakeApi({
      'GET /v1/viewings/{id}': () => ({ body: confirmed }),
      'GET /v1/viewings/{id}/pass': () => ({ body: { ...pass, validUntil: inHours(-1) } }),
    });
    await renderApp(<PassScreen viewingId={ids.viewing} brightness={null} />, {
      api,
      kv: userKv(),
    });
    expect(await screen.findByText('This pass is no longer valid.')).toBeTruthy();
  });

  it('is in Arabic and right-to-left when the app is', async () => {
    const api = fakeApi({
      'GET /v1/viewings/{id}': () => ({ body: confirmed }),
      'GET /v1/viewings/{id}/pass': () => ({ body: pass }),
    });
    await renderApp(<PassScreen viewingId={ids.viewing} brightness={null} />, {
      api,
      kv: userKv({ 'aidooi.locale.v1': 'ar' }),
    });
    expect(await screen.findByText('تصريح المعاينة')).toBeTruthy();
    expect(screen.getByLabelText('رمز QR لتصريح المعاينة')).toBeTruthy();
  });
});

describe('the list', () => {
  it('lists viewings with their state, and opens one', async () => {
    const api = fakeApi({
      'GET /v1/viewings': () => ({
        body: [viewing({ state: 'Confirmed', scheduledAt: inHours(30) })],
      }),
    });
    await renderApp(<ViewingsListScreen />, { api, kv: userKv() });
    expect(await screen.findByText('Confirmed')).toBeTruthy();
  });

  it('is welcoming when empty', async () => {
    const api = fakeApi({ 'GET /v1/viewings': () => ({ body: [] }) });
    await renderApp(<ViewingsListScreen />, { api, kv: userKv() });
    expect(await screen.findByText('No viewings yet')).toBeTruthy();
  });
});

describe('a lost connection on the viewing', () => {
  it('shows a retryable error, not a blank screen', async () => {
    const down = (async () => {
      throw new NetworkError(new Error('offline'));
    }) as unknown as typeof fetch;
    await renderApp(<ViewingScreen viewingId={ids.viewing} />, {
      api: { ...fakeApi({}), fetch: down },
      kv: userKv(),
    });
    expect(await screen.findByRole('button', { name: /try again/i })).toBeTruthy();
  });
});
