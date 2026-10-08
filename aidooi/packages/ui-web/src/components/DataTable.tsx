import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../cx.ts';
import { useT } from '../locale.tsx';
import { Skeleton } from './Spinner.tsx';
import { EmptyState, ErrorState } from './states.tsx';

export type SortDirection = 'asc' | 'desc';
export interface Sort {
  columnId: string;
  direction: SortDirection;
}

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  sortable?: boolean;
  /** Numbers and money align to the inline-end so digits line up in both directions. */
  numeric?: boolean;
}

export interface DataTableProps<T> {
  /** Names the table for assistive technology. Required: an unnamed grid is unusable by ear. */
  caption: string;
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  sort?: Sort | undefined;
  onSortChange?: ((s: Sort) => void) | undefined;
  selected?: ReadonlySet<string> | undefined;
  onSelectionChange?: ((s: ReadonlySet<string>) => void) | undefined;
  onRowActivate?: ((row: T) => void) | undefined;
  loading?: boolean | undefined;
  error?: unknown;
  onRetry?: (() => void) | undefined;
  empty?: ReactNode;
  stickyHeader?: boolean | undefined;
}

const nextDirection = (current: Sort | undefined, id: string): SortDirection =>
  current?.columnId === id && current.direction === 'asc' ? 'desc' : 'asc';

/**
 * A data grid that works by keyboard: Tab enters the body once, ↑/↓/Home/End move between rows,
 * Space toggles the row's selection, Enter activates it. Sorting and selection are controlled by the app.
 */
export function DataTable<T>(p: DataTableProps<T>) {
  const t = useT();
  const [focused, setFocused] = useState(0);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const selectable = Boolean(p.onSelectionChange);
  const selected = p.selected ?? new Set<string>();

  if (p.error) return <ErrorState error={p.error} onRetry={p.onRetry} />;
  if (!p.loading && p.rows.length === 0) return <>{p.empty ?? <EmptyState />}</>;

  const move = (i: number) => {
    const clamped = Math.max(0, Math.min(p.rows.length - 1, i));
    setFocused(clamped);
    rowRefs.current[clamped]?.focus();
  };
  const toggle = (key: string) => {
    const next = new Set(selected);
    if (!next.delete(key)) next.add(key);
    p.onSelectionChange?.(next);
  };
  const allKeys = p.rows.map(p.rowKey);
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, i: number, row: T) => {
    if (e.target !== e.currentTarget) return; // keys inside a cell's own controls belong to them
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        return move(i + 1);
      case 'ArrowUp':
        e.preventDefault();
        return move(i - 1);
      case 'Home':
        e.preventDefault();
        return move(0);
      case 'End':
        e.preventDefault();
        return move(p.rows.length - 1);
      case ' ':
        if (selectable) {
          e.preventDefault();
          toggle(p.rowKey(row));
        }
        return;
      case 'Enter':
        if (p.onRowActivate) {
          e.preventDefault();
          p.onRowActivate(row);
        }
    }
  };

  return (
    <div
      className={cx('ui-table-wrap', p.stickyHeader && 'is-sticky')}
      aria-busy={p.loading || undefined}
    >
      <table className="ui-table">
        <caption className="ui-visually-hidden">{p.caption}</caption>
        <thead>
          <tr>
            {selectable && (
              <th scope="col" className="ui-table__select">
                <input
                  type="checkbox"
                  aria-label={t.selectAll}
                  checked={allSelected}
                  onChange={() => p.onSelectionChange?.(allSelected ? new Set() : new Set(allKeys))}
                />
              </th>
            )}
            {p.columns.map((c) => {
              const active = p.sort?.columnId === c.id ? p.sort : undefined;
              return (
                <th
                  key={c.id}
                  scope="col"
                  className={cx(c.numeric && 'is-numeric')}
                  aria-sort={
                    active
                      ? active.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : c.sortable
                        ? 'none'
                        : undefined
                  }
                >
                  {c.sortable ? (
                    <button
                      type="button"
                      className="ui-table__sort"
                      onClick={() =>
                        p.onSortChange?.({ columnId: c.id, direction: nextDirection(p.sort, c.id) })
                      }
                    >
                      {c.header}
                      <span aria-hidden="true">
                        {active ? (active.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                      </span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {p.loading
            ? Array.from({ length: 5 }, (_, i) => (
                <tr key={i} aria-hidden="true">
                  {selectable && <td />}
                  {p.columns.map((c) => (
                    <td key={c.id}>
                      <Skeleton />
                    </td>
                  ))}
                </tr>
              ))
            : p.rows.map((row, i) => {
                const key = p.rowKey(row);
                const isSel = selected.has(key);
                return (
                  <tr
                    key={key}
                    ref={(el) => {
                      rowRefs.current[i] = el;
                    }}
                    tabIndex={i === focused ? 0 : -1}
                    aria-selected={selectable ? isSel : undefined}
                    className={cx(isSel && 'is-selected')}
                    onFocus={() => setFocused(i)}
                    onKeyDown={(e) => onRowKey(e, i, row)}
                    onDoubleClick={() => p.onRowActivate?.(row)}
                  >
                    {selectable && (
                      <td className="ui-table__select">
                        <input
                          type="checkbox"
                          aria-label={t.selectRow}
                          checked={isSel}
                          onChange={() => toggle(key)}
                          tabIndex={-1}
                        />
                      </td>
                    )}
                    {p.columns.map((c) => (
                      <td key={c.id} className={cx(c.numeric && 'is-numeric')}>
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
        </tbody>
      </table>
      {selectable && (
        <p className="ui-table__count" aria-live="polite">
          {t.fmt('selectedCount', { n: selected.size })}
        </p>
      )}
    </div>
  );
}
