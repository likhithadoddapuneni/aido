import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx.ts';
import { useT } from '../locale.tsx';
import { Spinner } from './Spinner.tsx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant | undefined;
  /** Shows a spinner, announces busy, and ignores clicks, without changing the button's size. */
  loading?: boolean | undefined;
}

export function Button({
  variant = 'secondary',
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={cx('ui-btn', `ui-btn--${variant}`, loading && 'is-loading', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <Spinner inline />}
      <span className="ui-btn__label">{children}</span>
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'aria-label'> {
  /** An icon-only control has no text, so its accessible name is mandatory. */
  label: string;
  icon: ReactNode;
}

export function IconButton({ label, icon, className, ...rest }: IconButtonProps) {
  return (
    <Button {...rest} aria-label={label} title={label} className={cx('ui-btn--icon', className)}>
      <span aria-hidden="true">{icon}</span>
    </Button>
  );
}

/** Close affordance used by overlays. */
export function CloseButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  return <IconButton variant="ghost" label={t.close} icon="✕" onClick={onClick} />;
}
