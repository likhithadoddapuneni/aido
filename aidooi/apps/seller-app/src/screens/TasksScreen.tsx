import { useRouter } from 'expo-router';
import { Badge, EmptyState, ListRow, Screen, Text, useLocale, useT } from '@aidooi/ui-native';
import { View } from 'react-native';
import { catalogue } from '../i18n/index.ts';
import type { InboxTask } from '../domain/tasks.ts';
import { Countdown } from '../ui/Countdown.tsx';
import { OfflineBanner } from '../ui/OfflineBanner.tsx';
import { QueryState } from '../ui/Query.tsx';
import { useInbox } from './useTasks.ts';

export function taskTitle(
  t: ReturnType<typeof useT<typeof catalogue.en>>,
  task: InboxTask,
): string {
  const kind = t(task.kind === 'viewing' ? 'tasks.kind.viewing' : 'tasks.kind.purchase');
  return task.where ? `${kind} · ${task.where}` : kind;
}

/** The inbox. Whatever lapses soonest is on top, because a lapsed task is treated as declined. */
export function TasksScreen() {
  const t = useT(catalogue);
  const router = useRouter();
  const { tasks, now, loading, error, refetch } = useInbox();
  useLocale();

  return (
    <Screen>
      <Text variant="h1">{t('tasks.title')}</Text>
      <OfflineBanner />
      <QueryState loading={loading} error={error} onRetry={refetch}>
        {tasks.length === 0 ? (
          <EmptyState title={t('tasks.empty.title')} message={t('tasks.empty.message')} />
        ) : (
          <View>
            {tasks.map((task) => (
              <ListRow
                key={task.key}
                title={taskTitle(t, task)}
                subtitle={task.items.map((i) => `${i.name} ×${i.quantity}`).join(' · ')}
                chevron
                onPress={() => router.push(`/task/${task.id}`)}
                trailing={
                  task.answer ? (
                    <Badge
                      label={t(`tasks.answered.${task.answer}`)}
                      tone={task.answer === 'Confirmed' ? 'ok' : 'neutral'}
                    />
                  ) : (
                    <Countdown dueAt={task.dueAt} now={now} />
                  )
                }
              />
            ))}
          </View>
        )}
      </QueryState>
    </Screen>
  );
}
