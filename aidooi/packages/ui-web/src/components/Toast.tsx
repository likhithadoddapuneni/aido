import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../cx.ts';
import { useT } from '../locale.tsx';
import type { Tone } from './Badge.tsx';
import { IconButton } from './Button.tsx';

export interface ToastInput {
  message: ReactNode;
  tone?: Tone | undefined;
  /** Milliseconds before it dismisses itself; 0 keeps it until dismissed. Errors default to staying. */
  durationMs?: number | undefined;
}
interface ToastItem extends ToastInput {
  id: number;
}

const ToastContext = createContext<{ push: (t: ToastInput) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (input: ToastInput) => {
      const id = ++seq.current;
      setItems((xs) => [...xs, { ...input, id }]);
      const ms = input.durationMs ?? (input.tone === 'err' ? 0 : 5000);
      if (ms > 0) setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext value={value}>
      {children}
      {createPortal(
        <div className="ui-toasts" role="region" aria-label={t.notifications} aria-live="polite">
          {items.map((i) => (
            <div
              key={i.id}
              className={cx('ui-toast', `ui-toast--${i.tone ?? 'neutral'}`)}
              role={i.tone === 'err' ? 'alert' : 'status'}
            >
              <span>{i.message}</span>
              <IconButton
                variant="ghost"
                label={t.dismiss}
                icon="✕"
                onClick={() => dismiss(i.id)}
              />
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext>
  );
}

export function useToast(): { push: (t: ToastInput) => void } {
  const v = useContext(ToastContext);
  if (!v) throw new Error('useToast must be used inside <ToastProvider>');
  return v;
}
