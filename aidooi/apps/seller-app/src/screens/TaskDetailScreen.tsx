import { useState } from 'react';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  Screen,
  Text,
  useLocale,
  useT,
  useTheme,
  useToast,
} from '@aidooi/ui-native';
import { catalogue } from '../i18n/index.ts';
import { allOnDisplay, findTask } from '../domain/tasks.ts';
import { useOnline } from '../net/online.ts';
import { Countdown } from '../ui/Countdown.tsx';
import { ConfirmSheet } from '../ui/ConfirmSheet.tsx';
import { messageFor } from '../ui/errors.ts';
import { OfflineBanner } from '../ui/OfflineBanner.tsx';
import { QueryState } from '../ui/Query.tsx';
import { useAuth } from '../session/auth.tsx';
import { Switch } from 'react-native';
import { taskTitle } from './TasksScreen.tsx';
import { useInbox, useRespond } from './useTasks.ts';

/**
 * One confirmation, with what answering means spelled out. Opened from the inbox or from a push
 * notification (`aidooiseller://task/<id>`).
 */
export function TaskDetailScreen({ id }: { id: string }) {
  const t = useT(catalogue);
  const { locale } = useLocale();
  const { space } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const online = useOnline();
  const { tasks, now, loading, error, refetch } = useInbox();
  const respond = useRespond();
  const [pending, setPending] = useState<'Confirmed' | 'Declined' | null>(null);
  const [noShow, setNoShow] = useState(false);
  const { data } = useAuth();
  const [display, setDisplay] = useState<boolean | null>(null);
  const task = findTask(tasks, id);

  const answer = async (response: 'Confirmed' | 'Declined') => {
    if (!task) return;
    try {
      await respond.mutateAsync({
        task,
        response,
        ...(task.kind === 'viewing' && response === 'Confirmed'
          ? { displayConfirmed: display ?? allOnDisplay(task) }
          : {}),
      });
      setPending(null);
      toast.show({
        message: t(('tasks.answered.' + response) as 'tasks.answered.Confirmed'),
        tone: 'ok',
      });
      router.back();
    } catch (e) {
      setPending(null);
      toast.show({ message: messageFor(e, locale), tone: 'error' });
    }
  };

  const recordOutcome = async (outcome: 'Completed' | 'No-show') => {
    if (!task?.viewingRequestId) return;
    try {
      await data.outcome(task.viewingRequestId, outcome);
      setNoShow(false);
      toast.show({ message: t('scan.outcomeSaved'), tone: 'ok' });
      router.back();
    } catch (e) {
      setNoShow(false);
      toast.show({ message: messageFor(e, locale), tone: 'error' });
    }
  };

  const kind = task?.kind ?? 'viewing';
  const key = (p: 'confirm' | 'decline') => `tasks.${kind}.${p}` as const;

  return (
    <Screen>
      <OfflineBanner />
      <QueryState loading={loading} error={error} onRetry={refetch}>
        {!task ? (
          <EmptyState
            title={t('tasks.notFound')}
            action={{ label: t('common.close'), onPress: () => router.back() }}
          />
        ) : (
          <View style={{ gap: space[3] }}>
            <Text variant="h1">{taskTitle(t, task)}</Text>
            {task.answer ? (
              <Badge
                label={t(`tasks.answered.${task.answer}`)}
                tone={task.answer === 'Confirmed' ? 'ok' : 'neutral'}
              />
            ) : (
              <Countdown dueAt={task.dueAt} now={now} />
            )}
            {task.items.map((item, i) => (
              <Card key={`${item.name}-${i}`}>
                <Text variant="h3">{item.name}</Text>
                <Text onSurface tone="secondary">
                  {t('orders.qty', { n: item.quantity })}
                  {item.detail.kind === 'stock'
                    ? ` · ${t('tasks.held', { n: item.detail.qty })} · ${t('tasks.sku', { sku: item.detail.sku })}`
                    : ''}
                </Text>
                {item.detail.kind === 'display' ? (
                  <Badge
                    label={t(
                      item.detail.onDisplay ? 'viewing.On Display' : 'viewing.Viewable on Request',
                    )}
                    tone={item.detail.onDisplay ? 'ok' : 'neutral'}
                  />
                ) : null}
              </Card>
            ))}
            {task.kind === 'viewing' && !task.answered ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: space[3],
                }}
              >
                <Text style={{ flex: 1 }}>{t('tasks.display')}</Text>
                <Switch
                  accessibilityLabel={t('tasks.display')}
                  value={display ?? allOnDisplay(task)}
                  onValueChange={setDisplay}
                />
              </View>
            ) : null}
            {task.kind === 'viewing' && task.answer === 'Confirmed' ? (
              <>
                <Text variant="label">{t('tasks.outcome.title')}</Text>
                <Button
                  title={t('scan.visited')}
                  disabled={!online}
                  onPress={() => recordOutcome('Completed')}
                />
                <Button
                  title={t('scan.noShow')}
                  variant="secondary"
                  disabled={!online}
                  onPress={() => setNoShow(true)}
                />
              </>
            ) : null}
            {!task.answered ? (
              <>
                {!online ? <Banner tone="warn" message={t('offline.message')} /> : null}
                <Button
                  title={t('tasks.confirm')}
                  disabled={!online}
                  onPress={() => setPending('Confirmed')}
                />
                <Button
                  title={t('tasks.decline')}
                  variant="secondary"
                  disabled={!online}
                  onPress={() => setPending('Declined')}
                />
              </>
            ) : null}
          </View>
        )}
      </QueryState>
      <ConfirmSheet
        visible={noShow}
        title={t('tasks.noShow.title')}
        body={t('tasks.noShow.body')}
        confirmLabel={t('scan.noShow')}
        destructive
        disabled={!online}
        onConfirm={() => recordOutcome('No-show')}
        onClose={() => setNoShow(false)}
      />
      {task && pending ? (
        <ConfirmSheet
          visible
          title={t(
            `${key(pending === 'Confirmed' ? 'confirm' : 'decline')}.title` as 'tasks.viewing.confirm.title',
          )}
          body={t(
            `${key(pending === 'Confirmed' ? 'confirm' : 'decline')}.body` as 'tasks.viewing.confirm.body',
          )}
          confirmLabel={pending === 'Confirmed' ? t('tasks.confirm') : t('tasks.decline')}
          destructive={pending === 'Declined'}
          disabled={!online}
          onConfirm={() => answer(pending)}
          onClose={() => setPending(null)}
        />
      ) : null}
    </Screen>
  );
}
