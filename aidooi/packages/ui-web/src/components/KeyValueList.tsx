import type { ReactNode } from 'react';

export function KeyValueList({
  items,
}: {
  items: readonly { key: string; label: ReactNode; value: ReactNode }[];
}) {
  return (
    <dl className="ui-kv">
      {items.map((i) => (
        <div key={i.key} className="ui-kv__row">
          <dt>{i.label}</dt>
          <dd>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}
