import { Button, Input } from '@aidooi/ui-web';
import { useS } from '../i18n/index.tsx';

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Day = (typeof DAYS)[number];
export type Hours = Partial<Record<Day, { open: string; close: string }[]>>;
const MAX_INTERVALS = 3;

/** Opening hours: up to three open/close intervals per day; no intervals means closed that day. */
export function HoursEditor({ value, onChange }: { value: Hours; onChange: (h: Hours) => void }) {
  const s = useS();
  const set = (day: Day, intervals: { open: string; close: string }[]) => {
    const next = { ...value };
    if (intervals.length === 0) delete next[day];
    else next[day] = intervals;
    onChange(next);
  };
  return (
    <fieldset className="portal-hours">
      <legend>{s.openingHours}</legend>
      {DAYS.map((day) => {
        const intervals = value[day] ?? [];
        return (
          <div key={day} className="portal-hours__day">
            <span className="portal-hours__name">{s.days[day]}</span>
            {intervals.length === 0 && <span className="portal-note">{s.closed}</span>}
            {intervals.map((iv, i) => (
              <span key={i} className="portal-hours__interval">
                <Input
                  type="time"
                  aria-label={s.fmt('opensAt', { day: s.days[day] })}
                  value={iv.open}
                  onChange={(e) =>
                    set(
                      day,
                      intervals.map((x, j) => (j === i ? { ...x, open: e.target.value } : x)),
                    )
                  }
                />
                <Input
                  type="time"
                  aria-label={s.fmt('closesAt', { day: s.days[day] })}
                  value={iv.close}
                  onChange={(e) =>
                    set(
                      day,
                      intervals.map((x, j) => (j === i ? { ...x, close: e.target.value } : x)),
                    )
                  }
                />
                <Button
                  variant="ghost"
                  aria-label={s.fmt('removeInterval', { day: s.days[day] })}
                  onClick={() =>
                    set(
                      day,
                      intervals.filter((_, j) => j !== i),
                    )
                  }
                >
                  {s.remove}
                </Button>
              </span>
            ))}
            {intervals.length < MAX_INTERVALS && (
              <Button
                variant="ghost"
                aria-label={s.fmt('addInterval', { day: s.days[day] })}
                onClick={() => set(day, [...intervals, { open: '10:00', close: '19:00' }])}
              >
                {s.add}
              </Button>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
