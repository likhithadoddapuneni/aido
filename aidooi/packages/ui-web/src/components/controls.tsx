import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cx } from '../cx.ts';
import { useFieldProps } from './Field.tsx';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...useFieldProps()} {...rest} className={cx('ui-input', className)} />;
}

export function Textarea({
  className,
  rows = 4,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...useFieldProps()}
      rows={rows}
      {...rest}
      className={cx('ui-input ui-textarea', className)}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...useFieldProps()} {...rest} className={cx('ui-input ui-select', className)}>
      {children}
    </select>
  );
}

interface ChoiceProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'> {
  label: ReactNode;
  hint?: ReactNode;
}

function Choice({
  kind,
  label,
  hint,
  className,
  ...rest
}: ChoiceProps & { kind: 'checkbox' | 'radio' | 'switch' }) {
  return (
    <label className={cx('ui-choice', `ui-choice--${kind}`, className)}>
      <input
        {...rest}
        type={kind === 'radio' ? 'radio' : 'checkbox'}
        role={kind === 'switch' ? 'switch' : undefined}
      />
      <span className="ui-choice__box" aria-hidden="true" />
      <span className="ui-choice__text">
        {label}
        {hint && <span className="ui-choice__hint">{hint}</span>}
      </span>
    </label>
  );
}

export const Checkbox = (p: ChoiceProps) => <Choice kind="checkbox" {...p} />;
export const Radio = (p: ChoiceProps) => <Choice kind="radio" {...p} />;
export const Switch = (p: ChoiceProps) => <Choice kind="switch" {...p} />;
