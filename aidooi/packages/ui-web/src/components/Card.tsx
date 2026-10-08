import type { ReactNode } from 'react';
import { useId } from 'react';
import { cx } from '../cx.ts';

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section className={cx('ui-card', className)} aria-labelledby={title ? id : undefined}>
      {(title || actions) && (
        <header className="ui-card__head">
          {title && (
            <h2 id={id} className="ui-card__title">
              {title}
            </h2>
          )}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
