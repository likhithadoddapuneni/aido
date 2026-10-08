import type { FormEvent, ReactNode } from 'react';
import { useT } from '../locale.tsx';
import { Button } from './Button.tsx';

/** A search landmark: fields in, one submit, one clear. The app owns the state and the query. */
export function FilterBar({
  children,
  onSubmit,
  onClear,
}: {
  children: ReactNode;
  onSubmit?: () => void;
  onClear?: () => void;
}) {
  const t = useT();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit?.();
  };
  return (
    <form role="search" className="ui-filter" onSubmit={submit}>
      <div className="ui-filter__fields">{children}</div>
      <div className="ui-filter__actions">
        {onSubmit && (
          <Button type="submit" variant="primary">
            {t.search}
          </Button>
        )}
        {onClear && (
          <Button variant="ghost" onClick={onClear}>
            {t.clearFilters}
          </Button>
        )}
      </div>
    </form>
  );
}
