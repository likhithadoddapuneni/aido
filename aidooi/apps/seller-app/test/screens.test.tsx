import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Network from 'expo-network';
import { StockScreen } from '../src/screens/StockScreen.tsx';
import { SignInScreen } from '../src/screens/SignInScreen.tsx';
import { MoreScreen } from '../src/screens/MoreScreen.tsx';
import { ar } from '../src/i18n/ar.ts';
import { en } from '../src/i18n/strings.ts';
import { problem, renderApp, route } from './support.tsx';

const offer = (over: Record<string, unknown> = {}) => ({
  id: 'offer-1',
  productName: 'Oak Table',
  sku: 'OAK-1',
  availability: 'In stock',
  version: 7,
  stockQty: 10,
  reservedQty: 3,
  sellingPrice: 125_000,
  viewingStatus: 'Viewable on Request',
  ...over,
});
const offers = (o = offer()) =>
  route('GET', '/v1/seller/offers', () => ({ body: { items: [o], nextCursor: null } }));

const mockedRouter = (
  jest.requireMock('expo-router') as { useRouter: () => { push: jest.Mock; replace: jest.Mock } }
).useRouter();
const router = { result: { current: mockedRouter } };

describe('StockScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('staff see no price field; managers do', async () => {
    await renderApp(<StockScreen />, { role: 'seller_staff', routes: [offers()] });
    await fireEvent.press(await screen.findByText('Oak Table'));
    expect(await screen.findByText(en['stock.qty'], { exact: true })).toBeTruthy();
    expect(screen.queryByText(en['stock.price'])).toBeNull();
  });

  it('managers see the price field', async () => {
    await renderApp(<StockScreen />, { role: 'seller_manager', routes: [offers()] });
    await fireEvent.press(await screen.findByText('Oak Table'));
    expect(await screen.findByText(en['stock.price'])).toBeTruthy();
  });

  it('saves only what changed, with the version seen, and confirms display', async () => {
    const h = await renderApp(<StockScreen />, {
      role: 'seller_staff',
      routes: [
        offers(),
        route('PATCH', '/v1/seller/offers/offer-1', () => ({ body: offer({ version: 8 }) })),
      ],
    });
    await fireEvent.press(await screen.findByText('Oak Table'));
    await fireEvent.press(await screen.findByText(en['viewing.On Display']));
    await fireEvent.press(screen.getByText(en['common.save']));
    await waitFor(() => expect(h.calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(h.calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      expectedVersion: 7,
      viewingStatus: 'On Display',
      displayConfirmed: true,
    });
  });

  it('explains held stock when the server refuses to go below it', async () => {
    await renderApp(<StockScreen />, {
      role: 'seller_staff',
      routes: [
        offers(),
        route('PATCH', '/v1/seller/offers/offer-1', () =>
          problem(409, 'stock_below_reserved', '3 unit(s) are held by buyers'),
        ),
      ],
    });
    await fireEvent.press(await screen.findByText('Oak Table'));
    await fireEvent.press(await screen.findByLabelText(/decrease|Decrease/i));
    await fireEvent.press(screen.getByText(en['common.save']));
    expect(await screen.findByText(/3 unit\(s\) are held/)).toBeTruthy();
  });

  it('reloads the latest on a version conflict', async () => {
    const h = await renderApp(<StockScreen />, {
      role: 'seller_staff',
      routes: [
        offers(),
        route('PATCH', '/v1/seller/offers/offer-1', () => problem(409, 'offer_version_conflict')),
      ],
    });
    await fireEvent.press(await screen.findByText('Oak Table'));
    await fireEvent.press(await screen.findByText(en['viewing.Not Viewable']));
    await fireEvent.press(screen.getByText(en['common.save']));
    await waitFor(() =>
      expect(
        h.calls.filter((c) => c.method === 'GET' && c.path.startsWith('/v1/seller/offers')).length,
      ).toBeGreaterThan(1),
    );
    expect(await screen.findByText(en['stock.conflict'])).toBeTruthy();
  });

  it('disables saving while offline', async () => {
    (Network.getNetworkStateAsync as jest.Mock).mockResolvedValue({
      isConnected: false,
      isInternetReachable: false,
    } as never);
    const h = await renderApp(<StockScreen />, { role: 'seller_staff', routes: [offers()] });
    expect(await screen.findByText(en['offline.title'])).toBeTruthy();
    await fireEvent.press(await screen.findByText('Oak Table'));
    await fireEvent.press(await screen.findByText(en['viewing.On Display']));
    await fireEvent.press(screen.getByText(en['common.save']));
    expect(h.calls.some((c) => c.method === 'PATCH')).toBe(false);
    (Network.getNetworkStateAsync as jest.Mock).mockResolvedValue({
      isConnected: true,
      isInternetReachable: true,
    } as never);
  });
});

describe('SignInScreen', () => {
  const fill = async () => {
    await fireEvent.changeText(
      await screen.findByLabelText(en['auth.email']),
      'Owner@Showroom.test',
    );
    await fireEvent.changeText(screen.getByLabelText(en['auth.password']), 'a-long-password-1');
    await fireEvent.changeText(screen.getByTestId('otp-input'), '123456');
  };

  it('sends the normalised email and routes to enrolment when MFA is not set up', async () => {
    const h = await renderApp(<SignInScreen />, {
      signedIn: false,
      routes: [route('POST', '/v1/auth/staff/login', () => problem(403, 'mfa_enrolment_required'))],
    });
    await fill();
    await fireEvent.press(screen.getByText(en['auth.signIn']));
    await waitFor(() => expect(router.result.current.push).toHaveBeenCalledWith('/enroll'));
    expect(h.calls.find((c) => c.path === '/v1/auth/staff/login')?.body).toEqual({
      email: 'owner@showroom.test',
      password: 'a-long-password-1',
      totpCode: '123456',
    });
  });

  it('rejects a non-seller account without storing a session', async () => {
    const h = await renderApp(<SignInScreen />, {
      signedIn: false,
      routes: [
        route('POST', '/v1/auth/staff/login', () => ({
          body: {
            accessToken: 'a',
            refreshToken: 'r',
            staff: { kind: 'ops', id: 'x', role: 'ops_admin' },
          },
        })),
      ],
    });
    await fill();
    await fireEvent.press(screen.getByText(en['auth.signIn']));
    await waitFor(() => expect(h.calls.some((c) => c.path === '/v1/auth/staff/login')).toBe(true));
    expect(await h.store.read()).toBeNull();
    expect(router.result.current.replace).not.toHaveBeenCalledWith('/');
  });

  it('keeps Sign in disabled until the form is complete', async () => {
    const h = await renderApp(<SignInScreen />, { signedIn: false });
    await fireEvent.press(await screen.findByText(en['auth.signIn']));
    expect(h.calls).toHaveLength(0);
  });
});

describe('Arabic', () => {
  it('renders Arabic copy and shows the staff role', async () => {
    await renderApp(<MoreScreen />, { locale: 'ar', role: 'seller_staff' });
    expect(await screen.findByText(ar['more.title'])).toBeTruthy();
    expect(screen.getByText(ar['more.role.seller_staff'])).toBeTruthy();
    expect(screen.queryByText(en['more.title'])).toBeNull();
  });
  it('renders the stock screen in Arabic', async () => {
    await renderApp(<StockScreen />, { locale: 'ar', routes: [offers()] });
    expect(await screen.findByText(ar['stock.title'])).toBeTruthy();
    expect(await screen.findByText('Oak Table')).toBeTruthy();
  });
});
