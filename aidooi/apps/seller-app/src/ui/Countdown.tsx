import { Text, useT } from '@aidooi/ui-native';
import { countdown, formatCountdown, remainingMs, urgencyOf, type Urgency } from '../domain/sla.ts';
import { catalogue } from '../i18n/index.ts';

const TONE: Record<Urgency, 'default' | 'warn' | 'error' | 'ok'> = {
  ok: 'ok',
  soon: 'default',
  critical: 'warn',
  overdue: 'error',
};

/** Time left (or overdue) for a task. The wording is translated; the digits stay Latin so they read the same everywhere. */
export function Countdown({ dueAt, now }: { dueAt: string; now: number }) {
  const t = useT(catalogue);
  const ms = remainingMs(dueAt, now);
  const c = countdown(ms);
  const time = formatCountdown(c);
  return (
    <Text variant="label" tone={TONE[urgencyOf(ms)]} accessibilityLiveRegion="none">
      {c.overdue ? t('tasks.overdue', { time }) : t('tasks.due', { time })}
    </Text>
  );
}
