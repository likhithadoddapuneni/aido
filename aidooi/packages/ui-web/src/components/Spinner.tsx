import { cx } from '../cx.ts';
import { useT } from '../locale.tsx';

export function Spinner({ inline = false }: { inline?: boolean }) {
  const t = useT();
  return (
    <span
      role="status"
      aria-label={t.loading}
      className={cx('ui-spinner', inline && 'ui-spinner--inline')}
    />
  );
}

/** A placeholder block. Decorative: pair with `aria-busy` on the region it stands in for. */
export function Skeleton({ width, height = '1em' }: { width?: string; height?: string }) {
  return (
    <span
      aria-hidden="true"
      className="ui-skeleton"
      style={{ inlineSize: width ?? '100%', blockSize: height }}
    />
  );
}
