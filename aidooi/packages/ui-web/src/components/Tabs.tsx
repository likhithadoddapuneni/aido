import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useLocale } from '../locale.tsx';

export interface TabItem {
  id: string;
  label: ReactNode;
  panel: ReactNode;
}

/** WAI-ARIA tabs: one tab stop, arrow keys move (and flip with RTL), Home/End jump. */
export function Tabs({
  tabs,
  label,
  value,
  onChange,
}: {
  tabs: readonly TabItem[];
  label: string;
  value?: string;
  onChange?: (id: string) => void;
}) {
  const { dir } = useLocale();
  const base = useId();
  const [inner, setInner] = useState(tabs[0]?.id);
  const current = value ?? inner;
  const refs = useRef(new Map<string, HTMLButtonElement>());

  const select = (id: string) => {
    if (value === undefined) setInner(id);
    onChange?.(id);
    refs.current.get(id)?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === current);
    const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const back = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    const target =
      e.key === forward
        ? i + 1
        : e.key === back
          ? i - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? tabs.length - 1
              : null;
    if (target === null) return;
    e.preventDefault();
    const next = tabs[(target + tabs.length) % tabs.length];
    if (next) select(next.id);
  };

  return (
    <div className="ui-tabs">
      <div role="tablist" aria-label={label} className="ui-tabs__list" onKeyDown={onKey}>
        {tabs.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              if (el) refs.current.set(t.id, el);
            }}
            role="tab"
            type="button"
            id={`${base}-tab-${t.id}`}
            aria-selected={t.id === current}
            aria-controls={`${base}-panel-${t.id}`}
            tabIndex={t.id === current ? 0 : -1}
            className="ui-tabs__tab"
            onClick={() => select(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${base}-panel-${t.id}`}
          aria-labelledby={`${base}-tab-${t.id}`}
          hidden={t.id !== current}
          tabIndex={0}
          className="ui-tabs__panel"
        >
          {t.id === current && t.panel}
        </div>
      ))}
    </div>
  );
}
