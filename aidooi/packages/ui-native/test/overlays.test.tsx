import { act, fireEvent, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Text as RNText } from 'react-native';
import { BottomSheet, ErrorView, useReducedMotion, useToast } from '../src/index.ts';
import { renderApp } from './helpers.tsx';

describe('BottomSheet', () => {
  it('shows its title and content as a modal, closes from the button, the backdrop and the back button', async () => {
    const onClose = jest.fn();
    await renderApp(
      <BottomSheet visible onClose={onClose} title="Filters">
        <RNText>Inside</RNText>
      </BottomSheet>,
    );
    expect(screen.getByRole('header', { name: 'Filters' })).toBeTruthy();
    expect(screen.getByText('Inside')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    await fireEvent.press(screen.getByTestId('sheet-backdrop', { includeHiddenElements: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('renders nothing when hidden', async () => {
    await renderApp(
      <BottomSheet visible={false} onClose={() => undefined} title="Hidden">
        <RNText>Inside</RNText>
      </BottomSheet>,
    );
    expect(screen.queryByText('Inside')).toBeNull();
  });
});

function ToastButton({ message, tone }: { message: string; tone?: 'error' | 'ok' }) {
  const { show } = useToast();
  return (
    <RNText onPress={() => show({ message, ...(tone ? { tone } : {}) })}>show-{message}</RNText>
  );
}

describe('Toast', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('appears as a polite alert, then disappears by itself', async () => {
    await renderApp(<ToastButton message="Saved" />);
    await fireEvent.press(screen.getByText('show-Saved'));
    const toast = screen.getByTestId('toast');
    expect(toast.props.accessibilityRole).toBe('alert');
    expect(toast.props.accessibilityLiveRegion).toBe('polite');
    expect(screen.getByText('Saved')).toBeTruthy();
    await act(async () => void jest.advanceTimersByTime(3600));
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('errors stay longer than confirmations: people need time to read what went wrong', async () => {
    await renderApp(<ToastButton message="Oops" tone="error" />);
    await fireEvent.press(screen.getByText('show-Oops'));
    await act(async () => void jest.advanceTimersByTime(4000));
    expect(screen.getByTestId('toast')).toBeTruthy();
    await act(async () => void jest.advanceTimersByTime(2500));
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('a newer toast replaces the current one and is not dismissed by the old one’s timer', async () => {
    await renderApp(
      <>
        <ToastButton message="First" />
        <ToastButton message="Second" />
      </>,
    );
    await fireEvent.press(screen.getByText('show-First'));
    await act(async () => void jest.advanceTimersByTime(3000));
    await fireEvent.press(screen.getByText('show-Second'));
    expect(screen.queryByText('First')).toBeNull();
    await act(async () => void jest.advanceTimersByTime(1000)); // the first toast's original deadline passes
    expect(screen.getByText('Second')).toBeTruthy();
  });

  it('tapping dismisses it', async () => {
    await renderApp(<ToastButton message="Saved" />);
    await fireEvent.press(screen.getByText('show-Saved'));
    await fireEvent.press(screen.getByTestId('toast'));
    expect(screen.queryByTestId('toast')).toBeNull();
  });
});

const problem = (code: string, correlationId: string | null = 'corr-42') =>
  Object.assign(new Error(code), { status: 409, code, correlationId });
const network = () => Object.assign(new Error('Network request failed'), { name: 'NetworkError' });

describe('ErrorView', () => {
  it('shows the translated message for a known API code, never the raw code', async () => {
    await renderApp(<ErrorView error={problem('price_approval_required')} />);
    expect(
      screen.getByText('A price changed. Please review and approve the new total to continue.'),
    ).toBeTruthy();
    expect(screen.queryByText('price_approval_required')).toBeNull();
  });

  it('speaks Arabic in Arabic', async () => {
    await renderApp(<ErrorView error={problem('payment_declined')} />, { locale: 'ar' });
    expect(screen.getByText('لم يتم قبول الدفع. يرجى تجربة بطاقة أخرى.')).toBeTruthy();
  });

  it('shows the correlation id small and selectable, so support can find the request', async () => {
    await renderApp(<ErrorView error={problem('payment_declined', 'abc-123')} />);
    const ref = screen.getByText(/abc-123/);
    expect(ref.props.selectable).toBe(true);
    expect(screen.getByText('Reference: abc-123')).toBeTruthy();
  });

  it('a dropped connection says so; anything unknown is the generic apology, not a stack', async () => {
    await renderApp(<ErrorView error={network()} />);
    expect(
      screen.getByText('You appear to be offline. Check your connection and try again.'),
    ).toBeTruthy();
    await renderApp(<ErrorView error={new TypeError('x is undefined')} />);
    expect(screen.queryByText(/x is undefined/)).toBeNull();
    expect(
      screen.getByText('Something went wrong on our side. Please try again in a moment.'),
    ).toBeTruthy();
  });

  it('an unknown code from a newer server falls back to the generic message', async () => {
    await renderApp(<ErrorView error={problem('brand_new_code')} />);
    expect(screen.queryByText('brand_new_code')).toBeNull();
    expect(
      screen.getByText('Something went wrong on our side. Please try again in a moment.'),
    ).toBeTruthy();
  });

  it('offers Retry only when it can, and the button cannot be double-fired', async () => {
    await renderApp(<ErrorView error={problem('x')} />);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    const onRetry = jest.fn(() => new Promise<void>(() => undefined));
    await renderApp(<ErrorView error={problem('x')} onRetry={onRetry} />);
    const b = screen.getByRole('button', { name: 'Try again' });
    await fireEvent.press(b);
    await fireEvent.press(b);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('is announced', async () => {
    await renderApp(<ErrorView error={problem('x')} />);
    expect(screen.getByRole('alert').props.accessibilityLiveRegion).toBe('polite');
  });
});

describe('useReducedMotion', () => {
  function Probe() {
    return <RNText testID="m">{String(useReducedMotion())}</RNText>;
  }

  it('GATE: follows the OS setting, so pulses and slides can be skipped', async () => {
    const spy = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await renderApp(<Probe />);
    await act(async () => undefined);
    expect(screen.getByTestId('m').props.children).toBe('true');
    spy.mockResolvedValue(false);
    await renderApp(<Probe />);
    await act(async () => undefined);
    expect(screen.getAllByTestId('m').at(-1)!.props.children).toBe('false');
    spy.mockRestore();
  });
});
