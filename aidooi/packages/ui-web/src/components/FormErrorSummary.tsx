import { useEffect, useRef } from 'react';
import type { FieldError } from '../types.ts';
import { useT } from '../locale.tsx';

/**
 * Lists every field error from a failed submit and moves focus to the list, so keyboard and
 * screen-reader users land on what to fix. Each entry focuses its control (`id` = the API path).
 */
export function FormErrorSummary({
  errors,
  fieldId = (path) => path,
}: {
  errors: readonly FieldError[];
  fieldId?: (path: string) => string;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (errors.length > 0) ref.current?.focus();
  }, [errors]);
  if (errors.length === 0) return null;
  return (
    <div ref={ref} tabIndex={-1} role="alert" className="ui-error-summary">
      <h2 className="ui-error-summary__title">{t.errorsFound}</h2>
      <ul>
        {errors.map((e) => (
          <li key={`${e.path}:${e.message}`}>
            <a
              href={`#${fieldId(e.path)}`}
              onClick={(ev) => {
                const el = document.getElementById(fieldId(e.path));
                if (el) {
                  ev.preventDefault();
                  el.focus();
                }
              }}
            >
              {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
