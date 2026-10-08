import { Share, StyleSheet } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AccountScreen } from '../src/features/transact/AccountScreen.tsx';
import { AddressesScreen } from '../src/features/transact/AddressesScreen.tsx';
import { NotificationsScreen } from '../src/features/transact/NotificationsScreen.tsx';
import { PrivacyScreen } from '../src/features/transact/PrivacyScreen.tsx';
import type { PushRegistrar } from '../src/features/transact/push.ts';
import { address, dataExport, ids, me } from './transact.fixtures.ts';
import { fakeApi, guestKv, renderApp, router, userKv } from './support.tsx';

const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));

describe('account', () => {
  const api = (extra: Parameters<typeof fakeApi>[0] = {}) =>
    fakeApi({ 'GET /v1/me': () => ({ body: me() }), ...extra });

  it('a guest is invited to sign in and can still change the language', async () => {
    await renderApp(<AccountScreen />, { kv: guestKv() });
    expect(await screen.findByText('You are browsing as a guest')).toBeTruthy();
    await press('Sign in');
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/sign-in'));
    expect(screen.getByText('العربية')).toBeTruthy();
  });

  it('shows the profile and saves a changed name, only when it changed', async () => {
    const a = api({ 'PATCH /v1/me': () => ({ body: me() }) });
    await renderApp(<AccountScreen />, { api: a, kv: userKv() });
    const field = await screen.findByDisplayValue('Amal Hassan');
    expect(screen.getByRole('button', { name: 'Save' }).props.accessibilityState.disabled).toBe(
      true,
    );
    await fireEvent.changeText(field, 'Amal H. Hassan');
    await press('Save');
    await waitFor(() => expect(a.called('PATCH', '/v1/me')).toHaveLength(1));
    expect(a.called('PATCH', '/v1/me')[0]?.body).toEqual({ fullName: 'Amal H. Hassan' });
  });

  it('switching language flips the screen to Arabic right-to-left and tells the server', async () => {
    const a = api({ 'PATCH /v1/me': () => ({ body: me() }) });
    await renderApp(<AccountScreen />, { api: a, kv: userKv() });
    await screen.findByDisplayValue('Amal Hassan');
    await fireEvent.press(screen.getByText('العربية'));
    const title = await screen.findByText('الحساب');
    expect(StyleSheet.flatten(title.props.style).writingDirection).toBe('rtl');
    await waitFor(() => expect(a.called('PATCH', '/v1/me')[0]?.body).toEqual({ locale: 'ar' }));
  });

  it('links to viewings, addresses, notifications and privacy', async () => {
    await renderApp(<AccountScreen />, { api: api(), kv: userKv() });
    await screen.findByDisplayValue('Amal Hassan');
    for (const [label, href] of [
      ['My viewings', '/viewing'],
      ['Delivery addresses', '/account/addresses'],
      ['Notifications', '/account/notifications'],
      ['Privacy and data', '/account/privacy'],
    ] as const) {
      await fireEvent.press(screen.getByRole('button', { name: label }));
      expect(router.push).toHaveBeenLastCalledWith(href);
    }
  });

  it('signing out drops the session', async () => {
    const kv = userKv();
    await renderApp(<AccountScreen />, {
      api: api({ 'POST /v1/auth/logout': () => ({ status: 204, body: null }) }),
      kv,
    });
    await screen.findByDisplayValue('Amal Hassan');
    await press('Sign out');
    await waitFor(async () => expect(await kv.get('aidooi.session.v1')).toBeNull());
  });
});

describe('addresses', () => {
  const list = [
    address(),
    address({
      id: ids.stop,
      label: 'Office',
      line1: 'Office 4, JLT',
      area: 'JLT',
      isDefault: false,
    }),
  ];

  it('lists saved addresses with the default marked', async () => {
    await renderApp(<AddressesScreen />, {
      api: fakeApi({ 'GET /v1/me/addresses': () => ({ body: list }) }),
      kv: userKv(),
    });
    expect(await screen.findByText('Default')).toBeTruthy();
    expect(screen.getByText('Villa 12, Street 4, Al Barsha, Al Barsha, Dubai')).toBeTruthy();
  });

  it('adds an address: validated locally, then created', async () => {
    const api = fakeApi({
      'GET /v1/me/addresses': () => ({ body: [] }),
      'POST /v1/me/addresses': () => ({ status: 201, body: address() }),
    });
    await renderApp(<AddressesScreen />, { api, kv: userKv() });
    await press('Add address');
    await press('Save address');
    expect((await screen.findAllByText('Please check this value.')).length).toBeGreaterThan(0);
    expect(api.called('POST', '/v1/me/addresses')).toHaveLength(0);
    await fireEvent.changeText(screen.getByLabelText('Address'), 'Flat 9, Marina Tower');
    await fireEvent.press(screen.getByText('Dubai'));
    await press('Save address');
    await waitFor(() => expect(api.called('POST', '/v1/me/addresses')).toHaveLength(1));
    expect(api.called('POST', '/v1/me/addresses')[0]?.body).toMatchObject({
      line1: 'Flat 9, Marina Tower',
      emirate: 'Dubai',
    });
  });

  it('edits an address in place', async () => {
    const api = fakeApi({
      'GET /v1/me/addresses': () => ({ body: list }),
      'PUT /v1/me/addresses/{id}': () => ({ body: address() }),
    });
    await renderApp(<AddressesScreen />, { api, kv: userKv() });
    await fireEvent.press(await screen.findByRole('button', { name: /Office/ }));
    await fireEvent.changeText(screen.getByDisplayValue('Office 4, JLT'), 'Office 5, JLT');
    await press('Save address');
    await waitFor(() => expect(api.called('PUT', `/v1/me/addresses/${ids.stop}`)).toHaveLength(1));
    expect(api.called('PUT', `/v1/me/addresses/${ids.stop}`)[0]?.body).toMatchObject({
      line1: 'Office 5, JLT',
      label: 'Office',
    });
  });

  it('deleting takes a second, explicit tap', async () => {
    const api = fakeApi({
      'GET /v1/me/addresses': () => ({ body: list }),
      'DELETE /v1/me/addresses/{id}': () => ({ status: 204, body: null }),
    });
    await renderApp(<AddressesScreen />, { api, kv: userKv() });
    await screen.findByText('Default');
    await fireEvent.press(screen.getAllByRole('button', { name: 'Delete' })[1]!);
    expect(api.called('DELETE', '/v1/me/addresses')).toHaveLength(0);
    await press('Delete this address?');
    await waitFor(() =>
      expect(api.called('DELETE', `/v1/me/addresses/${ids.stop}`)).toHaveLength(1),
    );
  });
});

describe('notifications', () => {
  const registrar = (over: Partial<PushRegistrar> = {}): PushRegistrar & { request: jest.Mock } =>
    ({
      permission: async () => 'undetermined',
      request: jest.fn(async () => 'device-push-token-1'),
      ...over,
    }) as PushRegistrar & { request: jest.Mock };

  it('explains what it is for BEFORE any system prompt, and asks only when the buyer chooses', async () => {
    const r = registrar();
    await renderApp(<NotificationsScreen registrar={r} />, {
      api: fakeApi({ 'PUT /v1/me/devices': () => ({ status: 204, body: null }) }),
      kv: userKv(),
    });
    expect(await screen.findByText('What we would tell you about')).toBeTruthy();
    expect(screen.getByText(/Your viewing is confirmed/)).toBeTruthy();
    expect(screen.getByText('No offers, no reminders to come back.')).toBeTruthy();
    expect(r.request).not.toHaveBeenCalled();
  });

  it('registers the device token once permission is granted, and remembers it', async () => {
    const r = registrar();
    const kv = userKv();
    const api = fakeApi({
      'PUT /v1/me/devices': () => ({ status: 204, body: null }),
      'DELETE /v1/me/devices': () => ({ status: 204, body: null }),
    });
    await renderApp(<NotificationsScreen registrar={r} />, { api, kv });
    await screen.findByText('What we would tell you about');
    await press('Turn on notifications');
    await waitFor(() => expect(api.called('PUT', '/v1/me/devices')).toHaveLength(1));
    expect(api.called('PUT', '/v1/me/devices')[0]?.body).toMatchObject({
      pushToken: 'device-push-token-1',
    });
    expect(await screen.findByRole('button', { name: 'Turn off notifications' })).toBeTruthy();
    await press('Turn off notifications');
    await waitFor(() => expect(api.called('DELETE', '/v1/me/devices')).toHaveLength(1));
    expect(api.called('DELETE', '/v1/me/devices')[0]?.body).toEqual({
      pushToken: 'device-push-token-1',
    });
  });

  it('a refusal at the system prompt registers nothing and points to settings', async () => {
    const r = registrar({ request: jest.fn(async () => null) });
    const api = fakeApi({});
    await renderApp(<NotificationsScreen registrar={r} />, { api, kv: userKv() });
    await screen.findByText('What we would tell you about');
    await press('Turn on notifications');
    expect(await screen.findByText(/Notifications are blocked for this app/)).toBeTruthy();
    expect(api.calls).toHaveLength(0);
  });
});

describe('privacy and data', () => {
  const consents = (...purposes: string[]) =>
    dataExport(
      purposes.map((purpose) => ({
        purpose: purpose as 'marketing',
        policyVersion: '2026-01',
        grantedAt: '2026-10-01T10:00:00.000Z',
        withdrawnAt: null,
      })),
    );

  it('shows each consent and flips it with grant and withdraw calls', async () => {
    let current = consents('terms');
    const api = fakeApi({
      'GET /v1/me/export': () => ({ body: current }),
      'PUT /v1/me/consent/{purpose}': () => {
        current = consents('terms', 'marketing');
        return {
          body: {
            purpose: 'marketing',
            policyVersion: '2026-01',
            grantedAt: '2026-10-07T10:00:00.000Z',
          },
        };
      },
      'DELETE /v1/me/consent/{purpose}': () => {
        current = consents('terms');
        return { status: 204, body: null };
      },
    });
    await renderApp(<PrivacyScreen />, { api, kv: userKv() });
    expect(await screen.findByText('Offers and news')).toBeTruthy();
    expect(screen.getAllByText('Off')).toHaveLength(2);
    await fireEvent.press(screen.getAllByText('Off')[0]!);
    await waitFor(() => expect(api.called('PUT', '/v1/me/consent/marketing')).toHaveLength(1));
    expect(api.called('PUT', '/v1/me/consent/marketing')[0]?.body).toEqual({
      policyVersion: '2026-01',
    });
    expect(await screen.findByText('On')).toBeTruthy();
    await fireEvent.press(screen.getByText('On'));
    await waitFor(() => expect(api.called('DELETE', '/v1/me/consent/marketing')).toHaveLength(1));
  });

  it('exports the data through the share sheet', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    const api = fakeApi({ 'GET /v1/me/export': () => ({ body: dataExport() }) });
    await renderApp(<PrivacyScreen />, { api, kv: userKv() });
    await screen.findByText('Your data');
    await press('Export my data');
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(String((share.mock.calls[0]![0] as { message: string }).message)).toContain(
      'Amal Hassan',
    );
    share.mockRestore();
  });

  it('erasure needs two deliberate steps and the typed word; nothing is sent before then', async () => {
    const kv = userKv();
    const api = fakeApi({
      'GET /v1/me/export': () => ({ body: dataExport() }),
      'POST /v1/me/erasure': () => ({ body: { status: 'erased' } }),
      'POST /v1/auth/logout': () => ({ status: 204, body: null }),
    });
    await renderApp(<PrivacyScreen />, { api, kv });
    await screen.findByText('Your data');
    expect(screen.getByText(/This cannot be undone/)).toBeTruthy();

    await press('Delete my account'); // step 1: reveal the confirmation
    expect(api.called('POST', '/v1/me/erasure')).toHaveLength(0);
    const confirm = screen.getByRole('button', { name: 'Delete permanently' });
    expect(confirm.props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByLabelText('Type “delete” to confirm'), 'del');
    expect(
      screen.getByRole('button', { name: 'Delete permanently' }).props.accessibilityState.disabled,
    ).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete permanently' }));
    expect(api.called('POST', '/v1/me/erasure')).toHaveLength(0);

    await fireEvent.changeText(screen.getByLabelText('Type “delete” to confirm'), 'delete'); // step 2: the word
    await press('Delete permanently');
    await waitFor(() => expect(api.called('POST', '/v1/me/erasure')).toHaveLength(1));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(await kv.get('aidooi.session.v1')).toBeNull(); // signed out
  });

  it('cancelling the erasure puts everything back', async () => {
    const api = fakeApi({ 'GET /v1/me/export': () => ({ body: dataExport() }) });
    await renderApp(<PrivacyScreen />, { api, kv: userKv() });
    await screen.findByText('Your data');
    await press('Delete my account');
    await press('Cancel');
    expect(screen.queryByRole('button', { name: 'Delete permanently' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeTruthy();
  });

  it('in Arabic the confirmation word is Arabic too', async () => {
    const api = fakeApi({ 'GET /v1/me/export': () => ({ body: dataExport() }) });
    await renderApp(<PrivacyScreen />, { api, kv: userKv({ 'aidooi.locale.v1': 'ar' }) });
    await screen.findByText('بياناتك');
    await press('حذف حسابي');
    expect(screen.getByLabelText('اكتب «احذف» للتأكيد')).toBeTruthy();
  });
});
