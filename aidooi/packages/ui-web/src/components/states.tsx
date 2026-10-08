import { ApiProblem, NetworkError } from '@aidooi/api-client';
import { errorMessage } from '@aidooi/i18n';
import type { ReactNode } from 'react';
import { useLocale, useT } from '../locale.tsx';
import { Button } from './Button.tsx';

export function EmptyState({
  title,
  description,
  action,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="ui-state">
      <h2 className="ui-state__title">{title ?? t.emptyTitle}</h2>
      {description && <p className="ui-state__text">{description}</p>}
      {action}
    </div>
  );
}

/** The sentence a person should read for any failure, in their language. Unknown failures stay generic. */
export function useProblemText(): (error: unknown) => string {
  const t = useT();
  const { locale } = useLocale();
  return (error) => {
    if (error instanceof NetworkError) return t.offline;
    return errorMessage(error instanceof ApiProblem ? error.code : 'internal_error', locale);
  };
}

/**
 * Renders any failure as plain words in the user's language, with the correlation id so a person can
 * quote it to support. Unknown failures never show a raw code or stack.
 */
export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: (() => void) | undefined;
}) {
  const t = useT();
  const text = useProblemText();
  const retryable =
    error instanceof NetworkError ||
    (error instanceof ApiProblem && (error.retryable || error.status >= 500));
  return (
    <div className="ui-state ui-state--error" role="alert">
      <h2 className="ui-state__title">{t.errorTitle}</h2>
      <p className="ui-state__text">{text(error)}</p>
      {error instanceof ApiProblem && error.correlationId && (
        <p className="ui-state__ref">
          {t.reference}: <bdi>{error.correlationId}</bdi>
        </p>
      )}
      {onRetry && retryable && (
        <Button variant="secondary" onClick={onRetry}>
          {t.retry}
        </Button>
      )}
    </div>
  );
}
