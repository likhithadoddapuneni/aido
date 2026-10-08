import type { ReactNode } from 'react';
import { cx } from '../cx.ts';

export type Tone = 'ok' | 'warn' | 'err' | 'neutral';

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: Tone | undefined;
  children: ReactNode;
}) {
  return <span className={cx('ui-badge', `ui-badge--${tone}`)}>{children}</span>;
}

/**
 * A status as text, never colour alone: the label carries the meaning and the dot is decoration.
 * Pass a `map` once per domain (order line states, partner statuses) and reuse it.
 */
export function StatusPill({
  status,
  map,
}: {
  status: string;
  map: Readonly<Record<string, Tone>>;
}) {
  return (
    <span className={cx('ui-badge', 'ui-badge--pill', `ui-badge--${map[status] ?? 'neutral'}`)}>
      <span aria-hidden="true" className="ui-badge__dot" />
      {status}
    </span>
  );
}
