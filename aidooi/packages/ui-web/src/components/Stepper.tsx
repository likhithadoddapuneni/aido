import type { ReactNode } from 'react';
import { cx } from '../cx.ts';
import { useT } from '../locale.tsx';

export function Stepper({ steps, current }: { steps: readonly ReactNode[]; current: number }) {
  const t = useT();
  return (
    <ol className="ui-stepper" aria-label={t.fmt('step', { n: current + 1, total: steps.length })}>
      {steps.map((s, i) => (
        <li
          key={i}
          className={cx(
            'ui-stepper__step',
            i < current && 'is-done',
            i === current && 'is-current',
          )}
          aria-current={i === current ? 'step' : undefined}
        >
          <span className="ui-stepper__n" aria-hidden="true">
            {i < current ? '✓' : i + 1}
          </span>
          <span>{s}</span>
          {i < current && <span className="ui-visually-hidden"> ({t.stepComplete})</span>}
        </li>
      ))}
    </ol>
  );
}
