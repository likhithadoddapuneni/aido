import { unwrap } from '@aidooi/api-client';
import { Card, ErrorState, PageHeader, Spinner, useApi } from '@aidooi/ui-web';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useS } from '../i18n/index.tsx';
import { can } from '../lib/permissions.ts';
import { useMe } from '../lib/me.tsx';

/** Counts that need someone today; each links to the screen where it is dealt with. */
export function DashboardScreen() {
  const s = useS();
  const api = useApi();
  const me = useMe();
  const role = me.data?.role;
  const canTasks = !!role && can(role, 'respondTasks');

  const purchases = useQuery({
    queryKey: ['purchase-tasks'],
    enabled: canTasks,
    queryFn: async () => (await unwrap(api.http.GET('/v1/seller/purchase-tasks'))).tasks,
  });
  const viewings = useQuery({
    queryKey: ['viewing-tasks'],
    enabled: canTasks,
    queryFn: async () => unwrap(api.http.GET('/v1/seller/viewing-tasks')),
  });
  const issues = useQuery({
    queryKey: ['issues', 'Open'],
    enabled: !!role && can(role, 'advanceOrders'),
    queryFn: async () =>
      unwrap(
        api.http.GET('/v1/seller/issues', { params: { query: { state: 'Open', limit: 100 } } }),
      ),
  });
  const lines = useQuery({
    queryKey: ['lines', 'Confirmed'],
    enabled: !!role && can(role, 'advanceOrders'),
    queryFn: async () =>
      unwrap(
        api.http.GET('/v1/seller/order-lines', {
          params: { query: { state: 'Confirmed', limit: 100 } },
        }),
      ),
  });

  if (me.isPending) return <Spinner />;
  if (me.error) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;

  const pending =
    (purchases.data ?? []).filter((t) => !t.responded).length +
    (viewings.data ?? []).filter((t) => !t.response).length;
  const tiles = [
    {
      show: canTasks,
      key: 'tasks',
      label: s.tilePendingTasks,
      value: pending,
      loading: purchases.isPending || viewings.isPending,
      to: '/tasks' as const,
    },
    {
      show: !!role && can(role, 'advanceOrders'),
      key: 'lines',
      label: s.tileToPrepare,
      value: lines.data?.items.length ?? 0,
      loading: lines.isPending,
      to: '/orders' as const,
    },
    {
      show: !!role && can(role, 'advanceOrders'),
      key: 'issues',
      label: s.tileOpenIssues,
      value: issues.data?.items.length ?? 0,
      loading: issues.isPending,
      to: '/issues' as const,
    },
  ].filter((t) => t.show);

  return (
    <>
      <PageHeader
        title={s.fmt('welcome', { name: me.data?.fullName ?? '' })}
        description={s.dashboardIntro}
      />
      <div className="portal-grid">
        {tiles.map((t) => (
          <Card key={t.key} title={t.label}>
            <p className="portal-figure">{t.loading ? '…' : t.value}</p>
            <Link to={t.to}>{s.open}</Link>
          </Card>
        ))}
      </div>
    </>
  );
}
