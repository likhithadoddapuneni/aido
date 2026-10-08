import { cloneElement, useId, useState, type ReactElement } from 'react';

type Describable = { 'aria-describedby'?: string };

/** A short, non-interactive hint on hover or keyboard focus; dismissed with Escape. The child must be focusable. */
export function Tooltip({
  label,
  children,
}: {
  label: string;
  children: ReactElement<Describable>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span
      className="ui-tooltip"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
    >
      {cloneElement(children, { 'aria-describedby': id })}
      <span id={id} role="tooltip" className="ui-tooltip__bubble" hidden={!open}>
        {label}
      </span>
    </span>
  );
}
