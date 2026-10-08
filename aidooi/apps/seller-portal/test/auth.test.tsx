import { errorMessage } from '@aidooi/i18n';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ar } from '../src/i18n/ar.ts';
import { en } from '../src/i18n/en.ts';
import { meFor, expectNoViolations, problem, renderPortal, type Routes } from './harness.tsx';

// jsdom has no canvas; the QR encoder is not what these tests are about.
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,AAAA' } }));

const CATALOGUE = { en, ar };
const session = (kind: 'seller' | 'ops') => ({
  body: {
    tokenType: 'Bearer',
    accessToken: 'access-1',
    expiresIn: 900,
    refreshToken: 'refresh-1',
    staff:
      kind === 'seller'
        ? {
            kind,
            id: meFor('seller_owner').id,
            role: 'seller_owner',
            partnerId: meFor('seller_owner').partnerId,
          }
        : { kind, id: meFor('seller_owner').id, role: 'ops_admin' },
  },
});
const DASH: Routes = {
  'GET /v1/seller/purchase-tasks': { body: { tasks: [] } },
  'GET /v1/seller/viewing-tasks': { body: [] },
  'GET /v1/seller/order-lines': { body: { items: [], nextCursor: null } },
  'GET /v1/seller/issues': { body: { items: [], nextCursor: null } },
};

/** At least one alert on screen carries the text (a form can also raise a summary or a toast). */
const expectAlert = async (text: string) => {
  await waitFor(() =>
    expect(screen.getAllByRole('alert').some((a) => a.textContent?.includes(text))).toBe(true),
  );
};

const fill = async (
  user: ReturnType<typeof renderPortal>['user'],
  l: typeof en,
  totp = '123456',
) => {
  await user.type(await screen.findByLabelText(new RegExp(l.email)), 'sara@seller.test');
  await user.type(screen.getByLabelText(new RegExp(l.password)), 'correct horse battery');
  await user.type(screen.getByLabelText(new RegExp(l.totpCode)), totp);
  await user.click(screen.getByRole('button', { name: l.signIn }));
};

describe.each(['en', 'ar'] as const)('staff sign-in (%s)', (locale) => {
  const l = CATALOGUE[locale];

  it('is accessible and sends people who are not signed in to it', async () => {
    const { container, history } = renderPortal({ path: '/offers', locale, signedIn: false });
    await screen.findByRole('heading', { name: l.signInTitle });
    expect(history.location.pathname).toBe('/sign-in');
    await expectNoViolations(container);
  });

  it('signs in with password and authenticator code, then lands on the dashboard', async () => {
    const { user, store, history, calls } = renderPortal({
      path: '/sign-in',
      locale,
      signedIn: false,
      routes: { ...DASH, 'POST /v1/auth/staff/login': session('seller') },
    });
    await fill(user, l);
    await waitFor(() => expect(history.location.pathname).toBe('/'));
    expect(calls.find((c) => c.path === '/v1/auth/staff/login')?.body).toEqual({
      email: 'sara@seller.test',
      password: 'correct horse battery',
      totpCode: '123456',
    });
    expect(await store.read()).toEqual({
      kind: 'user',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    });
  });

  it('maps a rejected code through the shared error catalogue and stays signed out', async () => {
    const { user, store } = renderPortal({
      path: '/sign-in',
      locale,
      signedIn: false,
      routes: { 'POST /v1/auth/staff/login': problem(401, 'invalid_totp') },
    });
    await fill(user, l);
    await expectAlert(errorMessage('invalid_totp', locale));
    expect(await store.read()).toBeNull();
  });

  it('checks the code format before calling the API', async () => {
    const { user, calls } = renderPortal({ path: '/sign-in', locale, signedIn: false });
    await fill(user, l, '12');
    expect((await screen.findAllByText(l.vInvalid)).length).toBeGreaterThan(0);
    expect(calls.find((c) => c.path === '/v1/auth/staff/login')).toBeUndefined();
  });

  it('turns away an operations account and keeps no session', async () => {
    const { user, store } = renderPortal({
      path: '/sign-in',
      locale,
      signedIn: false,
      routes: { 'POST /v1/auth/staff/login': session('ops') },
    });
    await fill(user, l);
    expect(await screen.findByText(l.signInOpsAccount)).toBeInTheDocument();
    expect(await store.read()).toBeNull();
  });

  it('an account without an authenticator is taken to set one up, shows the key, and signs in on confirming', async () => {
    const { user, store, history, calls } = renderPortal({
      path: '/sign-in',
      locale,
      signedIn: false,
      routes: {
        ...DASH,
        'POST /v1/auth/staff/login': problem(403, 'mfa_enrolment_required'),
        'POST /v1/auth/staff/mfa/enroll': {
          body: {
            seed: 'JBSWY3DPEHPK3PXP',
            otpauthUri: 'otpauth://totp/AIDOOi:sara?secret=JBSWY3DPEHPK3PXP',
          },
        },
        'POST /v1/auth/staff/mfa/verify': session('seller'),
      },
    });
    await fill(user, l);
    await screen.findByRole('heading', { name: l.enrolTitle });
    expect(await screen.findByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: l.qrAlt })).toBeInTheDocument();
    await user.type(screen.getByLabelText(new RegExp(l.totpCode)), '654321');
    await user.click(screen.getByRole('button', { name: l.enrolConfirm }));
    await waitFor(() => expect(history.location.pathname).toBe('/'));
    expect(calls.find((c) => c.path === '/v1/auth/staff/mfa/verify')?.body).toMatchObject({
      totpCode: '654321',
    });
    expect(await store.read()).toMatchObject({ kind: 'user', accessToken: 'access-1' });
  });
});

describe('accepting an invitation', () => {
  it('sets a password, then goes straight to authenticator set-up with the same credentials', async () => {
    const { user, calls } = renderPortal({
      path: '/accept-invite?token=tok-0123456789abcdefghij',
      signedIn: false,
      routes: {
        'POST /v1/auth/staff/accept-invite': { body: { email: 'new@seller.test' } },
        'POST /v1/auth/staff/mfa/enroll': {
          body: {
            seed: 'JBSWY3DPEHPK3PXP',
            otpauthUri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP',
          },
        },
      },
    });
    await user.type(
      await screen.findByLabelText(new RegExp(en.newPassword)),
      'a long enough password',
    );
    await user.type(
      screen.getByLabelText(new RegExp(en.confirmPassword)),
      'a long enough password',
    );
    await user.click(screen.getByRole('button', { name: en.inviteContinue }));
    await screen.findByRole('heading', { name: en.enrolTitle });
    expect(calls.find((c) => c.path === '/v1/auth/staff/accept-invite')?.body).toEqual({
      token: 'tok-0123456789abcdefghij',
      password: 'a long enough password',
    });
    expect(calls.find((c) => c.path === '/v1/auth/staff/mfa/enroll')?.body).toEqual({
      email: 'new@seller.test',
      password: 'a long enough password',
    });
  });

  it('does not call the API when the two passwords differ', async () => {
    const { user, calls } = renderPortal({
      path: '/accept-invite?token=tok-0123456789abcdefghij',
      signedIn: false,
    });
    await user.type(
      await screen.findByLabelText(new RegExp(en.newPassword)),
      'a long enough password',
    );
    await user.type(
      screen.getByLabelText(new RegExp(en.confirmPassword)),
      'a different password!!',
    );
    await user.click(screen.getByRole('button', { name: en.inviteContinue }));
    expect((await screen.findAllByText(en.passwordsDiffer)).length).toBeGreaterThan(0);
    expect(calls.find((c) => c.path === '/v1/auth/staff/accept-invite')).toBeUndefined();
  });

  it('maps an expired invitation through the catalogue', async () => {
    const { user } = renderPortal({
      path: '/accept-invite?token=old-0123456789abcdefghij',
      signedIn: false,
      routes: { 'POST /v1/auth/staff/accept-invite': problem(410, 'invite_expired') },
    });
    await user.type(
      await screen.findByLabelText(new RegExp(en.newPassword)),
      'a long enough password',
    );
    await user.type(
      screen.getByLabelText(new RegExp(en.confirmPassword)),
      'a long enough password',
    );
    await user.click(screen.getByRole('button', { name: en.inviteContinue }));
    await expectAlert(errorMessage('invite_expired', 'en'));
  });
});

describe('an invitation link without a usable token', () => {
  it('explains instead of showing a form that cannot work', async () => {
    renderPortal({ path: '/accept-invite', signedIn: false });
    expect(await screen.findByText(en.inviteLinkInvalid)).toBeInTheDocument();
    expect(screen.queryByLabelText(new RegExp(en.newPassword))).toBeNull();
  });
});

describe('the session', () => {
  it('signing out revokes the login on the server and returns to sign-in', async () => {
    const { user, store, history, calls } = renderPortal({
      path: '/',
      routes: { ...DASH, 'POST /v1/auth/logout': { status: 204 } },
    });
    await user.click(await screen.findByRole('button', { name: /Sara Seller/ }));
    await user.click(screen.getByRole('button', { name: en.signOut }));
    await waitFor(() => expect(history.location.pathname).toBe('/sign-in'));
    expect(calls.find((c) => c.path === '/v1/auth/logout')?.body).toEqual({ refreshToken: 'r' });
    expect(await store.read()).toBeNull();
  });

  it('a token the API refuses and cannot refresh ends the session everywhere', async () => {
    const { history, store } = renderPortal({
      path: '/',
      routes: {
        ...DASH,
        'GET /v1/me': problem(401, 'invalid_token'),
        'POST /v1/auth/refresh': problem(401, 'invalid_token'),
      },
    });
    await waitFor(() => expect(history.location.pathname).toBe('/sign-in'));
    expect(await store.read()).toBeNull();
  });

  it('a buyer token is refused with an explanation instead of an empty portal', async () => {
    renderPortal({
      path: '/',
      routes: { 'GET /v1/me': { body: { kind: 'customer', id: meFor('x').id } } },
    });
    expect(await screen.findByRole('button', { name: en.signOut })).toBeVisible();
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});
