import { screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiProblem } from '@aidooi/api-client';
import {
  CsvDropzone,
  DataTable,
  FilterBar,
  Input,
  Field,
  checkCsv,
  type Column,
  type Sort,
} from '../src/index.ts';
import { LOCALES, renderIn } from './helpers.tsx';

interface Row {
  id: string;
  name: string;
  qty: number;
}
const ROWS: Row[] = [
  { id: 'a', name: 'Sofa', qty: 3 },
  { id: 'b', name: 'Lamp', qty: 12 },
  { id: 'c', name: 'Rug', qty: 1 },
];
const COLUMNS: Column<Row>[] = [
  { id: 'name', header: 'Name', cell: (r) => r.name, sortable: true },
  { id: 'qty', header: 'Qty', cell: (r) => r.qty, sortable: true, numeric: true },
];

function Table({ onActivate }: { onActivate?: (r: Row) => void }) {
  const [sort, setSort] = useState<Sort | undefined>();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const rows = [...ROWS].sort((a, b) =>
    sort
      ? (sort.columnId === 'qty' ? a.qty - b.qty : a.name.localeCompare(b.name)) *
        (sort.direction === 'asc' ? 1 : -1)
      : 0,
  );
  return (
    <DataTable
      caption="Stock"
      columns={COLUMNS}
      rows={rows}
      rowKey={(r) => r.id}
      sort={sort}
      onSortChange={setSort}
      selected={selected}
      onSelectionChange={setSelected}
      onRowActivate={onActivate}
    />
  );
}
const names = () =>
  within(document.querySelector('tbody') as HTMLElement)
    .getAllByRole('row')
    .map((r) => r.querySelectorAll('td')[1]?.textContent);

describe.each(LOCALES)('DataTable (%s)', (locale) => {
  it('is a named table; sortable headers expose aria-sort and flip asc → desc', async () => {
    const { user } = renderIn(<Table />, locale);
    expect(screen.getByRole('table', { name: 'Stock' })).toBeInTheDocument();
    const nameHeader = screen.getByRole('columnheader', { name: /Name/ });
    expect(nameHeader).toHaveAttribute('aria-sort', 'none');
    await user.click(within(nameHeader).getByRole('button'));
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
    expect(names()).toEqual(['Lamp', 'Rug', 'Sofa']);
    await user.click(within(nameHeader).getByRole('button'));
    expect(nameHeader).toHaveAttribute('aria-sort', 'descending');
    expect(names()).toEqual(['Sofa', 'Rug', 'Lamp']);
    expect(screen.getByRole('columnheader', { name: /Qty/ })).toHaveAttribute('aria-sort', 'none');
  });

  it('keyboard: one tab stop into the body, arrows/Home/End move, Space selects, Enter activates', async () => {
    const onActivate = vi.fn();
    const { user } = renderIn(<Table onActivate={onActivate} />, locale);
    const rows = () => within(document.querySelector('tbody') as HTMLElement).getAllByRole('row');
    expect(rows().filter((r) => r.getAttribute('tabindex') === '0')).toHaveLength(1);

    rows()[0]!.focus();
    await user.keyboard('{ArrowDown}');
    expect(rows()[1]).toHaveFocus();
    await user.keyboard('{End}');
    expect(rows()[2]).toHaveFocus();
    await user.keyboard('{ArrowDown}'); // clamps at the last row
    expect(rows()[2]).toHaveFocus();
    await user.keyboard('{Home}');
    expect(rows()[0]).toHaveFocus();

    await user.keyboard(' ');
    expect(rows()[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard(' ');
    expect(rows()[0]).toHaveAttribute('aria-selected', 'false');
    await user.keyboard('{Enter}');
    expect(onActivate).toHaveBeenCalledWith(ROWS[0]);
    // roving focus: the focused row is the tab stop
    expect(rows().filter((r) => r.getAttribute('tabindex') === '0')).toEqual([rows()[0]]);
  });

  it('selection: row checkboxes, select-all, and a live count', async () => {
    const { user } = renderIn(<Table />, locale);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(4);
    await user.click(
      screen.getByRole('checkbox', {
        name: locale === 'ar' ? 'تحديد كل الصفوف' : 'Select all rows',
      }),
    );
    expect(boxes.slice(1).every((b) => (b as HTMLInputElement).checked)).toBe(true);
    expect(document.querySelector('.ui-table__count')).toHaveTextContent(
      locale === 'ar' ? '3' : '3 selected',
    );
    await user.click(boxes[1]!);
    expect((boxes[0] as HTMLInputElement).checked).toBe(false);
  });

  it('shows loading, empty and error states instead of a bare table', async () => {
    const { rerender, user } = renderIn(
      <DataTable caption="x" columns={COLUMNS} rows={[]} rowKey={(r: Row) => r.id} loading />,
      locale,
    );
    expect(document.querySelector('.ui-table-wrap')).toHaveAttribute('aria-busy', 'true');
    rerender(<DataTable caption="x" columns={COLUMNS} rows={[]} rowKey={(r: Row) => r.id} />);
    expect(screen.getByRole('heading')).toBeInTheDocument();
    const retry = vi.fn();
    rerender(
      <DataTable
        caption="x"
        columns={COLUMNS}
        rows={[]}
        rowKey={(r: Row) => r.id}
        error={new ApiProblem({ status: 503, code: 'internal_error' })}
        onRetry={retry}
      />,
    );
    await user.click(screen.getByRole('button'));
    expect(retry).toHaveBeenCalled();
  });
});

describe('FilterBar and CsvDropzone', () => {
  it('FilterBar is a search landmark; Enter submits, Clear clears', async () => {
    const onSubmit = vi.fn();
    const onClear = vi.fn();
    const { user } = renderIn(
      <FilterBar onSubmit={onSubmit} onClear={onClear}>
        <Field label="Query">
          <Input />
        </Field>
      </FilterBar>,
    );
    await user.type(screen.getByLabelText('Query'), 'sofa{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('search')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('checkCsv guards type and size (pure)', () => {
    expect(checkCsv({ name: 'offers.csv', type: '', size: 10 }, 100)).toBeNull();
    expect(checkCsv({ name: 'offers', type: 'text/csv', size: 10 }, 100)).toBeNull();
    expect(checkCsv({ name: 'offers.xlsx', type: 'application/vnd.ms-excel', size: 10 }, 100)).toBe(
      'wrong_type',
    );
    expect(checkCsv({ name: 'offers.csv', type: 'text/csv', size: 101 }, 100)).toBe('too_large');
    expect(checkCsv({ name: 'offers.csv', type: 'text/csv', size: 100 }, 100)).toBeNull();
  });

  it.each(LOCALES)(
    'CsvDropzone accepts a CSV, rejects the wrong type and oversize with an announced reason (%s)',
    async (locale) => {
      const onFile = vi.fn();
      const { user } = renderIn(<CsvDropzone maxBytes={50} onFile={onFile} />, locale);
      const input = document.querySelector('input[type=file]') as HTMLInputElement;

      await user.upload(input, new File(['a,b'], 'offers.csv', { type: 'text/csv' }));
      expect(onFile).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'offers.csv' }));
      expect(screen.getByText('offers.csv')).toBeInTheDocument();

      await user.upload(input, new File(['x'.repeat(60)], 'big.csv', { type: 'text/csv' }));
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(onFile).toHaveBeenCalledTimes(1); // the oversize file never reached the app

      await user.click(
        screen.getByRole('button', { name: locale === 'ar' ? 'إزالة الملف' : 'Remove file' }),
      );
      expect(onFile).toHaveBeenLastCalledWith(null);
    },
  );
});
