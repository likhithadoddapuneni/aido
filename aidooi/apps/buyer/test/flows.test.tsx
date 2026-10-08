import { Text } from 'react-native';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { SignInScreen } from '../src/features/discovery/SignInScreen.tsx';
import { WizardScreen } from '../src/features/discovery/WizardScreen.tsx';
import { useAppState } from '../src/providers/AppProviders.tsx';
import { createPendingActions } from '../src/session/pendingAction.ts';
import { createSessionStore } from '../src/session/sessionStore.ts';
import { memoryKv } from '../src/storage/index.ts';
import { project } from './fixtures.ts';
import { fakeApi, guestKv, problem, renderApp, router } from './support.tsx';

const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));

describe('wizard screen', () => {
  it('will not move on from an empty space step, and says what is missing without calling the server', async () => {
    const api = fakeApi({});
    await renderApp(<WizardScreen pathId="livingRoom" />, { api });
    await press('Next');
    expect((await screen.findAllByText('Please fill this in.')).length).toBe(2);
    expect(api.calls).toHaveLength(0);
  });

  it('rejects a value outside the plannable range', async () => {
    await renderApp(<WizardScreen pathId="livingRoom" />);
    await fireEvent.changeText(screen.getByLabelText('Length (metres)'), '90');
    await fireEvent.changeText(screen.getByLabelText('Width (metres)'), '4');
    await press('Next');
    expect(await screen.findByText('This is outside the range we can plan for.')).toBeTruthy();
  });

  it('creates the project from validated input, letting AIDOOi choose style and colour, then goes to budgets', async () => {
    const created = project();
    const api = fakeApi({ 'POST /v1/projects': () => ({ status: 201, body: created }) });
    await renderApp(<WizardScreen pathId="livingRoom" />, { api });
    await fireEvent.changeText(screen.getByLabelText('Length (metres)'), '5');
    await fireEvent.changeText(screen.getByLabelText('Width (metres)'), '4');
    expect(await screen.findByText('About 20.0 m²')).toBeTruthy();
    await press('Next');
    expect((await screen.findAllByText('Let AIDOOi choose')).length).toBeGreaterThan(0);
    await press('See budgets and options');
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(`/project/${created.id}/budget`),
    );
    const body = api.called('POST', '/v1/projects')[0]?.body as { input: Record<string, unknown> };
    expect(body.input).toMatchObject({
      pathId: 'livingRoom',
      lengthM: 5,
      widthM: 4,
      style: 'assisted',
      colour: 'assisted',
    });
    expect(body.input).not.toHaveProperty('sizeClass'); // derived by the server, never sent
  });

  it('shows the server’s refusal translated and keeps what was typed', async () => {
    const api = fakeApi({ 'POST /v1/projects': () => problem(503, 'internal_error') });
    await renderApp(<WizardScreen pathId="livingRoom" />, { api });
    await fireEvent.changeText(screen.getByLabelText('Length (metres)'), '5');
    await fireEvent.changeText(screen.getByLabelText('Width (metres)'), '4');
    await press('Next');
    await press('See budgets and options');
    expect(
      await screen.findByText('Something went wrong on our side. Please try again in a moment.'),
    ).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('sign in', () => {
  const session = { accessToken: 'access-1', refreshToken: 'refresh-1' };

  const typePhoneAndSend = async () => {
    await fireEvent.changeText(screen.getByLabelText('Mobile number'), '0501234567');
    await fireEvent.press(screen.getByText('I accept the terms and privacy policy'));
    await press('Send code');
  };

  it('needs the terms accepted before it sends a code', async () => {
    const api = fakeApi({});
    await renderApp(<SignInScreen />, { api });
    await fireEvent.changeText(screen.getByLabelText('Mobile number'), '0501234567');
    await press('Send code');
    expect(await screen.findByText('Please accept the terms to continue.')).toBeTruthy();
    expect(api.calls).toHaveLength(0);
  });

  it('Apple and Google are present but honestly disabled', async () => {
    await renderApp(<SignInScreen />);
    expect(
      screen.getByRole('button', { name: 'Continue with Apple' }).props.accessibilityState.disabled,
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Continue with Google' }).props.accessibilityState
        .disabled,
    ).toBe(true);
    expect(
      screen.getByText('Apple and Google sign-in are not set up yet. Use your phone number.'),
    ).toBeTruthy();
  });

  it('upgrades the guest session with the guest token, then resumes the pending action', async () => {
    const kv = guestKv();
    await createPendingActions(kv).save('/viewing/new');
    const api = fakeApi({
      'POST /v1/auth/otp/request': () => ({ status: 202, body: {} }),
      'POST /v1/auth/otp/verify': () => ({ body: session }),
    });
    await renderApp(<SignInScreen />, { api, kv });
    await typePhoneAndSend();
    expect(await screen.findByText(/We sent a code to \+971501234567/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Send a new code in \d+s/ }).props.accessibilityState
        .disabled,
    ).toBe(true);
    await fireEvent.changeText(screen.getByTestId('otp-input'), '123456');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/viewing/new'));
    const verify = api.called('POST', '/v1/auth/otp/verify')[0]?.body as Record<string, unknown>;
    expect(verify).toMatchObject({
      phone: '+971501234567',
      code: '123456',
      guestToken: 'guest-token',
    });
    expect(await createSessionStore(kv).read()).toEqual({ kind: 'user', ...session });
    expect(await createPendingActions(kv).peek()).toBeNull(); // consumed, so it cannot replay
  });

  it('without a pending action it lands on the projects list', async () => {
    const api = fakeApi({
      'POST /v1/auth/otp/request': () => ({ status: 202, body: {} }),
      'POST /v1/auth/otp/verify': () => ({ body: session }),
    });
    await renderApp(<SignInScreen />, { api });
    await typePhoneAndSend();
    await fireEvent.changeText(await screen.findByTestId('otp-input'), '123456');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(tabs)/projects'));
  });

  it('a wrong code is explained, the boxes clear, and the guest session is untouched', async () => {
    const kv = guestKv();
    const api = fakeApi({
      'POST /v1/auth/otp/request': () => ({ status: 202, body: {} }),
      'POST /v1/auth/otp/verify': () => problem(401, 'otp_invalid'),
    });
    await renderApp(<SignInScreen />, { api, kv });
    await typePhoneAndSend();
    await fireEvent.changeText(await screen.findByTestId('otp-input'), '000000');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByTestId('otp-input').props.value).toBe('');
    expect(router.replace).not.toHaveBeenCalled();
    expect(await createSessionStore(kv).read()).toEqual({
      kind: 'guest',
      guestToken: 'guest-token',
    });
  });
});

describe('app providers', () => {
  function Probe() {
    const s = useAppState();
    return (
      <Text>{`${s.ready ? 'ready' : 'booting'} ${s.isGuest ? 'guest' : 'user'} ${s.locale}`}</Text>
    );
  }

  it('creates a guest session on first launch and persists it as one key', async () => {
    const kv = memoryKv();
    const api = fakeApi({
      'POST /v1/auth/guest': () => ({ status: 201, body: { guestToken: 'g-1' } }),
    });
    await renderApp(<Probe />, { api, kv });
    expect(await screen.findByText(/ready guest en/)).toBeTruthy();
    expect(await createSessionStore(kv).read()).toEqual({ kind: 'guest', guestToken: 'g-1' });
    expect(api.called('POST', '/v1/auth/guest')).toHaveLength(1);
  });

  it('keeps an existing session and does not ask the server for another', async () => {
    const api = fakeApi({});
    await renderApp(<Probe />, { api });
    expect(await screen.findByText(/ready guest/)).toBeTruthy();
    expect(api.calls).toHaveLength(0);
  });

  it('restores the stored language', async () => {
    await renderApp(<Probe />, { kv: guestKv({ 'aidooi.locale.v1': 'ar' }) });
    expect(await screen.findByText(/ready guest ar/)).toBeTruthy();
  });

  it('signing out returns to a fresh guest session', async () => {
    const kv = memoryKv({
      'aidooi.session.v1': JSON.stringify({ kind: 'user', accessToken: 'a', refreshToken: 'r' }),
    });
    const api = fakeApi({
      'POST /v1/auth/logout': () => ({ status: 204, body: null }),
      'POST /v1/auth/guest': () => ({ status: 201, body: { guestToken: 'g-2' } }),
    });
    let out: (() => Promise<void>) | undefined;
    function Out() {
      out = useAppState().signOut;
      return null;
    }
    await renderApp(
      <>
        <Probe />
        <Out />
      </>,
      { api, kv },
    );
    expect(await screen.findByText(/ready user/)).toBeTruthy();
    await out?.();
    await waitFor(async () =>
      expect(await createSessionStore(kv).read()).toEqual({ kind: 'guest', guestToken: 'g-2' }),
    );
    expect(
      (api.called('POST', '/v1/auth/logout')[0]?.body as { refreshToken: string }).refreshToken,
    ).toBe('r');
  });
});
