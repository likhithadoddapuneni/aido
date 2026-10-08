import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CursorPagination, useCursorPagination } from '../src/index.ts';
import { LOCALES, renderIn } from './helpers.tsx';

function Pager({ pages }: { pages: Record<string, string | null> }) {
  const p = useCursorPagination();
  const next = pages[p.cursor ?? 'first'] ?? null;
  return (
    <>
      <output data-testid="cursor">{p.cursor ?? 'first'}</output>
      <CursorPagination
        page={p.page}
        hasPrevious={p.hasPrevious}
        nextCursor={next}
        onNext={p.next}
        onPrevious={p.previous}
      />
    </>
  );
}

describe.each(LOCALES)('CursorPagination (%s)', (locale) => {
  const label = (en: string, ar: string) => (locale === 'ar' ? ar : en);

  it('walks forward and back through a keyset list, disabling the ends', async () => {
    const { user } = renderIn(<Pager pages={{ first: 'c2', c2: 'c3', c3: null }} />, locale);
    const next = screen.getByRole('button', { name: label('Next', 'التالي') });
    const prev = screen.getByRole('button', { name: label('Previous', 'السابق') });
    expect(prev).toBeDisabled();
    await user.click(next);
    await user.click(next);
    expect(screen.getByTestId('cursor')).toHaveTextContent('c3');
    expect(next).toBeDisabled(); // no nextCursor: last page
    await user.click(prev);
    expect(screen.getByTestId('cursor')).toHaveTextContent('c2');
    await user.click(prev);
    expect(screen.getByTestId('cursor')).toHaveTextContent('first');
    expect(prev).toBeDisabled();
  });

  it('is a labelled navigation landmark and cannot be used while busy', () => {
    const onNext = vi.fn();
    renderIn(
      <CursorPagination
        page={1}
        hasPrevious={false}
        nextCursor="c2"
        onNext={onNext}
        onPrevious={() => undefined}
        busy
      />,
      locale,
    );
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: label('Next', 'التالي') })).toBeDisabled();
  });
});
