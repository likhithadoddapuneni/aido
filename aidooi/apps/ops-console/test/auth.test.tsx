import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ar } from '../src/lib/catalogue.ar.ts';
import { overview } from './fixtures.ts';
import { expectNoViolations, LOCALES, meFor, problem, renderConsole } from './harness.tsx';

const session = (kind: 'ops' | 'seller') => ({
  accessToken: 'tok-a',
  refreshToken: 'tok-r',
  staff: { kind },
});

describe('sign-in', () => {
  for (const locale of LOCALES) {
    it(`renders and passes axe (${locale})`, async () => {
      const c = renderConsole({ signedIn: false, locale });
      await screen.findByLabelText(
        new RegExp(locale === 'en' ? 'Authenticator code' : ar['auth.code']),
      );
      await expectNoViolations(c.container);
    });
  }

  it('validates before sending: email, password and a six-digit code are all needed', async () => {
    const c = renderConsole({ signedIn: false });
    await c.user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect((await screen.findAllByText('This is required.')).length).toBeGreaterThan(0);
    expect(c.to('POST', '/v1/auth/staff/login')).toEqual([]);
  });

  it('signs in and lands on the overview', async () => {
    const c = renderConsole({
      signedIn: false,
      routes: {
        'POST /v1/auth/staff/login': { body: session('ops') },
        'GET /v1/me': { body: meFor('ops_admin') },
        'GET /v1/ops/overview': { body: overview() },
      },
    });
    await c.user.type(await screen.findByLabelText(/Email/), 'olu@aidooi.test');
    await c.user.type(screen.getByLabelText(/Password/), 'correct horse battery');
    await c.user.type(screen.getByLabelText(/Authenticator code/), '123456');
    await c.user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Overview', level: 1 })).toBeInTheDocument();
    expect(c.to('POST', '/v1/auth/staff/login')[0]?.body).toEqual({
      email: 'olu@aidooi.test',
      password: 'correct horse battery',
      totpCode: '123456',
    });
    expect(await c.store.read()).toMatchObject({ kind: 'user', accessToken: 'tok-a' });
  });

  it('says wrong credentials in words, never the raw code', async () => {
    const c = renderConsole({
      signedIn: false,
      routes: { 'POST /v1/auth/staff/login': problem(401, 'invalid_credentials') },
    });
    await c.user.type(await screen.findByLabelText(/Email/), 'olu@aidooi.test');
    await c.user.type(screen.getByLabelText(/Password/), 'x');
    await c.user.type(screen.getByLabelText(/Authenticator code/), '000000');
    await c.user.click(screen.getByRole('button', { name: 'Sign in' }));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.map((a) => a.textContent).join(' ')).not.toContain('invalid_credentials');
    expect(alerts.some((a) => (a.textContent ?? '').length > 0)).toBe(true);
  });

  it('refuses a seller account, ends the session it just created, and says why', async () => {
    const c = renderConsole({
      signedIn: false,
      routes: {
        'POST /v1/auth/staff/login': { body: session('seller') },
        'POST /v1/auth/logout': { status: 204 },
      },
    });
    await c.user.type(await screen.findByLabelText(/Email/), 'sara@seller.test');
    await c.user.type(screen.getByLabelText(/Password/), 'correct horse battery');
    await c.user.type(screen.getByLabelText(/Authenticator code/), '123456');
    await c.user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/seller portal/)).toBeInTheDocument();
    expect(c.to('POST', '/v1/auth/logout')[0]?.body).toEqual({ refreshToken: 'tok-r' });
    expect(await c.store.read()).toBeNull();
  });
});

describe('accepting an invitation', () => {
  it('without a token asks for the full link', async () => {
    renderConsole({ path: '/accept-invite', signedIn: false });
    expect(await screen.findByText(/link is incomplete/)).toBeInTheDocument();
  });

  const FLOW = {
    'POST /v1/auth/staff/accept-invite': { body: { email: 'new@aidooi.test' } },
    'POST /v1/auth/staff/mfa/enroll': {
      body: {
        seed: 'JBSWY3DPEHPK3PXP',
        otpauthUri: 'otpauth://totp/AIDOOi:new@aidooi.test?secret=JBSWY3DPEHPK3PXP',
      },
    },
    'POST /v1/auth/staff/mfa/verify': { body: session('ops') },
    'GET /v1/me': { body: meFor('ops_finance') },
    'GET /v1/ops/overview': { body: overview() },
  };

  it('password, then the authenticator seed, then a code, then signed in', async () => {
    const c = renderConsole({ path: '/accept-invite?token=tok123', signedIn: false, routes: FLOW });
    await c.user.type(
      await screen.findByLabelText(/Choose a password/),
      'a long enough passphrase',
    );
    await c.user.type(screen.getByLabelText(/Repeat the password/), 'a long enough passphrase');
    await c.user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByTestId('seed')).toHaveTextContent('JBSWY3DPEHPK3PXP');
    expect(c.to('POST', '/v1/auth/staff/accept-invite')[0]?.body).toEqual({
      token: 'tok123',
      password: 'a long enough passphrase',
    });
    await c.user.type(screen.getByLabelText(/Authenticator code/), '654321');
    await c.user.click(screen.getByRole('button', { name: 'Finish and sign in' }));
    expect(await screen.findByRole('heading', { name: 'Overview', level: 1 })).toBeInTheDocument();
    expect(c.to('POST', '/v1/auth/staff/mfa/verify')[0]?.body).toEqual({
      email: 'new@aidooi.test',
      password: 'a long enough passphrase',
      totpCode: '654321',
    });
  });

  it('catches two different passwords before calling the API', async () => {
    const c = renderConsole({ path: '/accept-invite?token=tok123', signedIn: false, routes: FLOW });
    await c.user.type(
      await screen.findByLabelText(/Choose a password/),
      'a long enough passphrase',
    );
    await c.user.type(screen.getByLabelText(/Repeat the password/), 'something else entirely');
    await c.user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('The two passwords do not match.')).toBeInTheDocument();
    expect(c.to('POST', '/v1/auth/staff/accept-invite')).toEqual([]);
  });

  it('an expired invitation is explained, not shown as a code', async () => {
    const c = renderConsole({
      path: '/accept-invite?token=old',
      signedIn: false,
      routes: { 'POST /v1/auth/staff/accept-invite': problem(400, 'invite_invalid') },
    });
    await c.user.type(
      await screen.findByLabelText(/Choose a password/),
      'a long enough passphrase',
    );
    await c.user.type(screen.getByLabelText(/Repeat the password/), 'a long enough passphrase');
    await c.user.click(screen.getByRole('button', { name: 'Continue' }));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.map((a) => a.textContent).join(' ')).not.toContain('invite_invalid');
  });

  it('passes axe on both steps in Arabic', async () => {
    const c = renderConsole({
      path: '/accept-invite?token=tok123',
      signedIn: false,
      locale: 'ar',
      routes: FLOW,
    });
    await screen.findByLabelText(new RegExp(ar['auth.setPassword']));
    await expectNoViolations(c.container);
    expect(document.documentElement.dir).toBe('rtl');
  });
});
