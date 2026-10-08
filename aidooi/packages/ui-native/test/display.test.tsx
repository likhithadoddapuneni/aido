import { fireEvent, screen } from '@testing-library/react-native';
import { color, contrast } from '@aidooi/ui-tokens';
import {
  Badge,
  Banner,
  Card,
  Chip,
  EmptyState,
  ListRow,
  Money,
  ProgressDots,
  QuantityStepper,
  SegmentedControl,
  Skeleton,
  badgeColours,
} from '../src/index.ts';
import { flat, renderApp } from './helpers.tsx';

describe('Badge', () => {
  it.each(Object.entries(badgeColours(color)))(
    'GATE: %s tone text meets WCAG AA on its background',
    (_tone, c) => {
      expect(contrast(c.fg, c.bg)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('is one accessible element named by its label', async () => {
    await renderApp(<Badge label="In stock" tone="ok" />);
    expect(screen.getByLabelText('In stock')).toBeTruthy();
  });
});

describe('Chip', () => {
  it('reports selection and presses', async () => {
    const onPress = jest.fn();
    await renderApp(<Chip label="Sofas" selected onPress={onPress} />);
    const chip = screen.getByRole('button', { name: 'Sofas' });
    expect(chip.props.accessibilityState).toMatchObject({ selected: true });
    expect(flat(chip.props.style).minHeight).toBeGreaterThanOrEqual(44);
    await fireEvent.press(chip);
    expect(onPress).toHaveBeenCalled();
  });
});

describe('Money', () => {
  it('formats integer fils for the locale and speaks the same text', async () => {
    await renderApp(<Money fils={123_456} />);
    expect(screen.getByLabelText(/1,234\.56/)).toBeTruthy();
    expect(screen.getByText(/1,234\.56/).props.style).toBeTruthy();
  });

  it('uses the Arabic dirham sign in Arabic', async () => {
    await renderApp(<Money fils={500_000} />, { locale: 'ar' });
    expect(screen.getByText(/5,000.*د\.إ/)).toBeTruthy();
  });

  it('GATE: refuses floats — money is integer fils everywhere', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(renderApp(<Money fils={12.5} />)).rejects.toThrow(/integer fils/);
  });

  it('shows the original price struck through only when it is higher, and reads it as "was"', async () => {
    await renderApp(<Money fils={80_000} originalFils={100_000} />);
    expect(screen.getByLabelText(/800.*was.*1,000/)).toBeTruthy();
    expect(flat(screen.getByText(/1,000/).props.style).textDecorationLine).toBe('line-through');
  });

  it('ignores an original price that is not higher', async () => {
    await renderApp(<Money fils={80_000} originalFils={80_000} />);
    expect(screen.queryByText(/line-through/)).toBeNull();
    expect(screen.getAllByText(/800/)).toHaveLength(1);
  });
});

describe('Banner', () => {
  it('warnings and errors are alerts in a live region; information is not', async () => {
    await renderApp(
      <>
        <Banner tone="warn" message="Prices changed" />
        <Banner tone="info" message="FYI" />
      </>,
    );
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.props.accessibilityLiveRegion).toBe('polite');
  });

  it('offers its action', async () => {
    const onPress = jest.fn();
    await renderApp(
      <Banner tone="warn" message="Prices changed" action={{ label: 'Refresh', onPress }} />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Refresh' }));
    expect(onPress).toHaveBeenCalled();
  });
});

describe('EmptyState, Card, ListRow', () => {
  it('EmptyState shows title, message and action', async () => {
    const onPress = jest.fn();
    await renderApp(
      <EmptyState
        title="No projects"
        message="Start one"
        action={{ label: 'New project', onPress }}
      />,
    );
    expect(screen.getByRole('header', { name: 'No projects' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'New project' }));
    expect(onPress).toHaveBeenCalled();
  });

  it('a pressable Card is a button; a plain Card is not', async () => {
    await renderApp(
      <>
        <Card onPress={() => undefined} accessibilityLabel="Open project" />
        <Card testID="plain" />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Open project' })).toBeTruthy();
    expect(screen.getByTestId('plain').props.accessibilityRole).toBeUndefined();
  });

  it('ListRow reads title and subtitle together and is a 44pt target', async () => {
    await renderApp(
      <ListRow title="Marina Living" subtitle="Dubai Marina" onPress={() => undefined} />,
    );
    const row = screen.getByRole('button', { name: 'Marina Living, Dubai Marina' });
    expect(flat(row.props.style).minHeight).toBeGreaterThanOrEqual(44);
  });

  it('a row that is not pressable still carries a custom accessibility label, so state is announced', async () => {
    await renderApp(<ListRow title="Form Vase" accessibilityLabel="Form Vase, not on view" />);
    expect(screen.getByLabelText('Form Vase, not on view')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('the disclosure chevron mirrors in right-to-left and is hidden from screen readers', async () => {
    await renderApp(<ListRow title="a" onPress={() => undefined} />);
    const icon = (): Parameters<typeof flat>[0] =>
      screen.getAllByTestId('icon-chevron', { includeHiddenElements: true }).at(-1)!.props.style;
    expect(flat(icon()).transform).toBeUndefined();
    await renderApp(<ListRow title="a" onPress={() => undefined} />, { locale: 'ar' });
    expect(flat(icon()).transform).toEqual([{ scaleX: -1 }]);
    const wrappers = screen.getAllByTestId('row-chevron', { includeHiddenElements: true });
    expect(wrappers.at(-1)!.props.accessibilityElementsHidden).toBe(true);
  });
});

describe('ProgressDots', () => {
  it('reads as one sentence, not as anonymous dots', async () => {
    await renderApp(<ProgressDots total={5} current={1} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.props.accessibilityLabel).toBe('Step 2 of 5');
    expect(bar.props.accessibilityValue).toEqual({ min: 1, max: 5, now: 2 });
  });

  it('fills the dots up to and including the current step', async () => {
    await renderApp(<ProgressDots total={3} current={1} />);
    const fill = (i: number) => flat(screen.getByTestId(`dot-${i}`).props.style).backgroundColor;
    expect(fill(0)).toBe(color.navy);
    expect(fill(1)).toBe(color.navy);
    expect(fill(2)).toBe(color.border);
  });

  it('speaks Arabic', async () => {
    await renderApp(<ProgressDots total={4} current={0} />, { locale: 'ar' });
    expect(screen.getByRole('progressbar').props.accessibilityLabel).toBe('الخطوة 1 من 4');
  });
});

describe('QuantityStepper', () => {
  it('steps within its bounds and disables the buttons at the limits', async () => {
    const onChange = jest.fn();
    await renderApp(<QuantityStepper value={1} min={1} max={3} onChange={onChange} />);
    expect(screen.getByLabelText('Decrease quantity').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByLabelText('Increase quantity'));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('cannot go past the maximum', async () => {
    await renderApp(<QuantityStepper value={3} min={1} max={3} onChange={() => undefined} />);
    expect(screen.getByLabelText('Increase quantity').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText('Quantity 3')).toBeTruthy();
  });
});

describe('SegmentedControl', () => {
  const options = [
    { value: 'a', label: 'Queen' },
    { value: 'b', label: 'King' },
  ] as const;

  it('marks the selected segment and reports a change to another', async () => {
    const onChange = jest.fn();
    await renderApp(<SegmentedControl options={options} value="a" onChange={onChange} />);
    expect(screen.getByLabelText('Queen').props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByLabelText('King'));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('does not re-report the segment that is already selected', async () => {
    const onChange = jest.fn();
    await renderApp(<SegmentedControl options={options} value="a" onChange={onChange} />);
    await fireEvent.press(screen.getByLabelText('Queen'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Skeleton', () => {
  it('announces itself as a loading indicator in the app language', async () => {
    await renderApp(<Skeleton height={40} />);
    expect(screen.getByRole('progressbar').props.accessibilityLabel).toBe('Loading');
    await renderApp(<Skeleton />, { locale: 'ar' });
    expect(screen.getAllByLabelText('جارٍ التحميل').length).toBeGreaterThan(0);
  });
});
