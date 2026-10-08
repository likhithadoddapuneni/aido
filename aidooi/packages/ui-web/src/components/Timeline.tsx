import type { ReactNode } from 'react';
import { cx } from '../cx.ts';
import type { Tone } from './Badge.tsx';

export interface TimelineEntry {
  id: string;
  title: ReactNode;
  /** Already-rendered time, usually `<DateTime>`. */
  at: ReactNode;
  description?: ReactNode;
  tone?: Tone;
}

/** Status history and audit trails: newest first by convention of the caller; this only renders. */
export function Timeline({ entries, label }: { entries: readonly TimelineEntry[]; label: string }) {
  return (
    <ol className="ui-timeline" aria-label={label}>
      {entries.map((e) => (
        <li
          key={e.id}
          className={cx('ui-timeline__item', `ui-timeline__item--${e.tone ?? 'neutral'}`)}
        >
          <div className="ui-timeline__title">{e.title}</div>
          <div className="ui-timeline__at">{e.at}</div>
          {e.description && <div className="ui-timeline__text">{e.description}</div>}
        </li>
      ))}
    </ol>
  );
}
