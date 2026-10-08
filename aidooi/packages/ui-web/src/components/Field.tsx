import { createContext, useContext, useId, type ReactNode } from 'react';
import { cx } from '../cx.ts';

interface FieldValue {
  readonly id: string;
  readonly describedBy: string | undefined;
  readonly invalid: boolean;
  readonly required: boolean;
}
const FieldContext = createContext<FieldValue | null>(null);

/** What a control inside a `<Field>` must spread on itself so the label, hint and error are announced. */
export function useFieldProps(): {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
} {
  const f = useContext(FieldContext);
  if (!f) return {};
  return {
    id: f.id,
    ...(f.describedBy ? { 'aria-describedby': f.describedBy } : {}),
    ...(f.invalid ? { 'aria-invalid': true as const } : {}),
    ...(f.required ? { 'aria-required': true as const } : {}),
  };
}

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  /** When set the field is invalid and the message is announced (assertive live region). */
  error?: string | undefined;
  required?: boolean | undefined;
  /** Use a stable id when something outside (an error summary) must link to the control. */
  id?: string | undefined;
  children: ReactNode;
}

/** Label + control + hint + error, wired with `for` / `aria-describedby`. */
export function Field({ label, hint, error, required = false, id, children }: FieldProps) {
  const auto = useId();
  const base = id ?? auto;
  const hintId = hint ? `${base}-hint` : undefined;
  const errorId = `${base}-error`;
  const describedBy = [hintId, error ? errorId : undefined].filter(Boolean).join(' ') || undefined;
  return (
    <FieldContext value={{ id: base, describedBy, invalid: Boolean(error), required }}>
      <div className={cx('ui-field', error && 'has-error')}>
        <label className="ui-field__label" htmlFor={base}>
          {label}
          {required && (
            <span aria-hidden="true" className="ui-field__req">
              {' '}
              *
            </span>
          )}
        </label>
        {children}
        {hint && (
          <p id={hintId} className="ui-field__hint">
            {hint}
          </p>
        )}
        <p id={errorId} role="alert" className="ui-field__error">
          {error}
        </p>
      </div>
    </FieldContext>
  );
}
