import { unwrap } from '@aidooi/api-client';
import {
  Button,
  Card,
  Checkbox,
  DateTime,
  EmptyState,
  ErrorState,
  Money,
  PageHeader,
  Spinner,
  Tabs,
  useApi,
  useApiMutation,
  useProblemText,
  useToast,
} from '@aidooi/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Guard } from '../components/Guard.tsx';
import { useS } from '../i18n/index.tsx';

type Tab = 'viewings' | 'purchases';

export function TasksScreen() {
  const s = useS();
  const [tab, setTab] = useState<Tab>('purchases');
  return (
    <Guard action="respondTasks">
      <PageHeader title={s.navTasks} description={s.tasksIntro} />
      <Tabs
        label={s.navTasks}
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        tabs={[
          { id: 'purchases', label: s.purchaseTasks, panel: <PurchaseTasks /> },
          { id: 'viewings', label: s.viewingTasks, panel: <ViewingTasks /> },
        ]}
      />
    </Guard>
  );
}

function PurchaseTasks() {
  const s = useS();
  const api = useApi();
  const toast = useToast();
  const problemText = useProblemText();
  const queries = useQueryClient();
  const query = useQuery({
    queryKey: ['purchase-tasks'],
    queryFn: async () => (await unwrap(api.http.GET('/v1/seller/purchase-tasks'))).tasks,
  });
  const respond = useApiMutation(
    async (v: { id: string; response: 'Confirmed' | 'Declined' }) =>
      unwrap(
        api.http.POST('/v1/seller/purchase-tasks/{taskId}/respond', {
          params: { path: { taskId: v.id } },
          body: { response: v.response },
        }),
      ),
    {
      onSuccess: async () => {
        toast.push({ message: s.taskAnswered, tone: 'ok' });
        await queries.invalidateQueries({ queryKey: ['purchase-tasks'] });
      },
    },
  );
  if (query.isPending) return <Spinner />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.data.length === 0) return <EmptyState title={s.noTasks} description={s.noTasksText} />;
  return (
    <ul className="portal-list">
      {query.data.map((t) => (
        <li key={t.id}>
          <Card title={s.fmt('dueBy', {})}>
            <p>
              <DateTime value={t.dueAt} />
            </p>
            <ul>
              {t.lines.map((l) => (
                <li key={l.offerId}>
                  {l.quantity} × {l.productName} ({l.sellerSku}) — <Money fils={l.unitPrice} /> ·{' '}
                  {s.stockLabel}: {l.stockQty}
                </li>
              ))}
            </ul>
            {t.responded ? (
              <p>{t.responded === 'Confirmed' ? s.confirmed : s.declined}</p>
            ) : (
              <div className="portal-actions">
                <Button
                  variant="primary"
                  loading={respond.isPending}
                  onClick={() => respond.mutate({ id: t.id, response: 'Confirmed' })}
                >
                  {s.confirm}
                </Button>
                <Button
                  variant="danger"
                  loading={respond.isPending}
                  onClick={() => respond.mutate({ id: t.id, response: 'Declined' })}
                >
                  {s.decline}
                </Button>
              </div>
            )}
            {respond.error ? (
              <p role="alert" className="portal-error">
                {problemText(respond.error)}
              </p>
            ) : null}
          </Card>
        </li>
      ))}
    </ul>
  );
}

function ViewingTasks() {
  const s = useS();
  const api = useApi();
  const toast = useToast();
  const problemText = useProblemText();
  const queries = useQueryClient();
  const [onDisplay, setOnDisplay] = useState<Record<string, boolean>>({});
  const query = useQuery({
    queryKey: ['viewing-tasks'],
    queryFn: async () => unwrap(api.http.GET('/v1/seller/viewing-tasks')),
  });
  const respond = useApiMutation(
    async (v: { id: string; response: 'Confirmed' | 'Declined'; displayConfirmed: boolean }) =>
      unwrap(
        api.http.POST('/v1/seller/viewing-tasks/{id}/respond', {
          params: { path: { id: v.id } },
          body: { response: v.response, displayConfirmed: v.displayConfirmed },
        }),
      ),
    {
      onSuccess: async () => {
        toast.push({ message: s.taskAnswered, tone: 'ok' });
        await queries.invalidateQueries({ queryKey: ['viewing-tasks'] });
      },
    },
  );
  if (query.isPending) return <Spinner />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.data.length === 0) return <EmptyState title={s.noTasks} description={s.noTasksText} />;
  return (
    <ul className="portal-list">
      {query.data.map((t) => (
        <li key={t.id}>
          <Card title={t.locationName}>
            <p>
              {s.fmt('dueBy', {})} <DateTime value={t.dueAt} />
            </p>
            <ul>
              {t.products.map((p) => (
                <li key={p.offerId}>{p.name}</li>
              ))}
            </ul>
            {t.response ? (
              <p>{t.response === 'Confirmed' ? s.confirmed : s.declined}</p>
            ) : (
              <>
                <Checkbox
                  label={s.allOnDisplay}
                  checked={onDisplay[t.id] ?? false}
                  onChange={(e) => setOnDisplay({ ...onDisplay, [t.id]: e.target.checked })}
                />
                <div className="portal-actions">
                  <Button
                    variant="primary"
                    loading={respond.isPending}
                    onClick={() =>
                      respond.mutate({
                        id: t.id,
                        response: 'Confirmed',
                        displayConfirmed: onDisplay[t.id] ?? false,
                      })
                    }
                  >
                    {s.confirm}
                  </Button>
                  <Button
                    variant="danger"
                    loading={respond.isPending}
                    onClick={() =>
                      respond.mutate({ id: t.id, response: 'Declined', displayConfirmed: false })
                    }
                  >
                    {s.decline}
                  </Button>
                </div>
              </>
            )}
            {respond.error ? (
              <p role="alert" className="portal-error">
                {problemText(respond.error)}
              </p>
            ) : null}
          </Card>
        </li>
      ))}
    </ul>
  );
}
