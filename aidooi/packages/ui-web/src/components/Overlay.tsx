import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../cx.ts';
import { useFocusTrap } from '../hooks/useFocusTrap.ts';
import { CloseButton } from './Button.tsx';

export interface OverlayProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** `centre` is a Dialog; `end` slides in from the inline-end edge (right in LTR, left in RTL). */
  placement?: 'centre' | 'end';
  /** Screen readers get a live description from this element. */
  describedById?: string | undefined;
}

/** Shared by Dialog and Drawer: modal semantics, focus trap, Escape, scroll lock, backdrop click. */
export function Overlay({
  open,
  onClose,
  title,
  children,
  footer,
  placement = 'centre',
  describedById,
}: OverlayProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, open, onClose);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="ui-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedById}
        tabIndex={-1}
        className={cx('ui-sheet', `ui-sheet--${placement}`)}
      >
        <div className="ui-sheet__head">
          <h2 id={titleId} className="ui-sheet__title">
            {title}
          </h2>
          <CloseButton onClick={onClose} />
        </div>
        <div className="ui-sheet__body">{children}</div>
        {footer && <div className="ui-sheet__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export const Dialog = (p: Omit<OverlayProps, 'placement'>) => <Overlay {...p} placement="centre" />;
export const Drawer = (p: Omit<OverlayProps, 'placement'>) => <Overlay {...p} placement="end" />;
