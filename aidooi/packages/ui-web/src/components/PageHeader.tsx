import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="ui-page-head">
      <div>
        <h1 className="ui-page-head__title">{title}</h1>
        {description && <p className="ui-page-head__text">{description}</p>}
      </div>
      {actions && <div className="ui-page-head__actions">{actions}</div>}
    </header>
  );
}
