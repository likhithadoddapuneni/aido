import { useLocale } from '../locale.tsx';

export const DEFAULT_TIME_ZONE = 'Asia/Dubai';

export interface DateTimeProps {
  value: string | number | Date;
  /** `date` for a day, `datetime` (default) for day and time. */
  style?: 'date' | 'datetime' | undefined;
  timeZone?: string | undefined;
}

export function DateTime({
  value,
  style = 'datetime',
  timeZone = DEFAULT_TIME_ZONE,
}: DateTimeProps) {
  const { locale } = useLocale();
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return <span>—</span>;
  const text = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE' : 'en-AE', {
    dateStyle: 'medium',
    ...(style === 'datetime' ? { timeStyle: 'short' as const } : {}),
    timeZone,
  }).format(d);
  return (
    <time dateTime={d.toISOString()}>
      <bdi>{text}</bdi>
    </time>
  );
}
