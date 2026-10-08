import { act, fireEvent, screen } from '@testing-library/react-native';
import { Button } from '../src/index.ts';
import { flat, renderApp } from './helpers.tsx';

describe('Button', () => {
  it('has a button role, a name, and a 44pt target', async () => {
    await renderApp(<Button title="Pay" onPress={() => undefined} />);
    const b = screen.getByRole('button', { name: 'Pay' });
    expect(b).toBeTruthy();
    expect(flat(b.props.style).minHeight).toBeGreaterThanOrEqual(44);
  });

  it('fires onPress', async () => {
    const onPress = jest.fn();
    await renderApp(<Button title="Go" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Go' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled or loading, and says it is busy', async () => {
    const onPress = jest.fn();
    await renderApp(
      <>
        <Button title="Off" disabled onPress={onPress} />
        <Button title="Busy" loading onPress={onPress} />
      </>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Off' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Busy' }));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Busy' }).props.accessibilityState).toMatchObject({
      busy: true,
      disabled: true,
    });
  });

  it('GATE: a slow async action cannot be double-fired — the second tap is ignored until it settles', async () => {
    let release!: () => void;
    const onPress = jest.fn(() => new Promise<void>((r) => (release = r)));
    await renderApp(<Button title="Pay" onPress={onPress} />);
    const b = () => screen.getByRole('button', { name: 'Pay' });
    await fireEvent.press(b());
    await fireEvent.press(b());
    await fireEvent.press(b());
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(b().props.accessibilityState.busy).toBe(true);
    await act(async () => release());
    await fireEvent.press(b());
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('GATE: two taps in the same frame (before any re-render) still fire once', async () => {
    const onPress = jest.fn(() => new Promise<void>(() => undefined));
    await renderApp(<Button title="Pay" onPress={onPress} />);
    const handler =
      screen.getByRole('button', { name: 'Pay' }).props.onClick ??
      screen.getByRole('button', { name: 'Pay' }).props.onPress;
    await act(async () => {
      handler();
      handler();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('a failing async action releases the button so the user can retry', async () => {
    const onPress = jest.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined);
    await renderApp(<Button title="Try" onPress={() => onPress().catch(() => undefined)} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Try' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Try' }));
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});
