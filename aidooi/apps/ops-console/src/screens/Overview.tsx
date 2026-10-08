import { unwrap } from '@aidooi/api-client';
import { Card, DateTime, ErrorState, PageHeader, Skeleton, useApi } from '@aidooi/ui-web';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useCopy, type CatalogueKey } from '../lib/i18n.ts';
import { can, type Capability } from '../lib/roles.ts';
import { useMe } from '../shell/Me.tsx';

type Counts = {
  verificationQueue: number;
  openIssues: number;
  confirmationsPastHalfSla: number;
  paymentsStuckAuthorized: number;
  settlementRunsAwaitingApproval: number;
};
const TILES: readonly { key: keyof Counts; label: CatalogueKey; to: string; cap: Capability }[] = [
  { key: 'verificationQueue', label: 'ov.verification', to: '/products', cap: 'products.read' },
  { key: 'openIssues', label: 'ov.issues', to: '/issues', cap: 'issues' },
  {
    key: 'confirmationsPastHalfSla',
    label: 'ov.confirmations',
    to: '/partners',
    cap: 'partners.read',
  },
  { key: 'paymentsStuckAuthorized', label: 'ov.payments', to: '/orders', cap: 'desk.read' },
  {
    key: 'settlementRunsAwaitingApproval',
    label: 'ov.runs',
    to: '/settlement',
    cap: 'settlement.read',
  },
];

/** Queue sizes at a glance. Each tile opens the screen that clears it, if this role has it. */
export function OverviewScreen() {
  const copy = useCopy();
  const api = useApi();
  const me = useMe();
  const q = useQuery({
    queryKey: ['overview'],
    queryFn: () => unwrap(api.http.GET('/v1/ops/overview')),
    refetchInterval: 30_000,
  });

  return (
    <div className="ops-stack">
      <PageHeader
        title={copy.t('ov.title')}
        description={
          q.data ? (
            <>
              {copy.t('ov.desc')} {copy.t('ov.asOf')} <DateTime value={q.data.asOf} />
            </>
          ) : (
            copy.t('ov.desc')
          )
        }
      />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="ops-grid">
          {TILES.map((t) => {
            const n = q.data?.[t.key];
            return (
              <Card key={t.key} title={copy.t(t.label)}>
                {n === undefined ? (
                  <Skeleton height="2rem" />
                ) : (
                  <p className="ops-stat" data-testid={`tile-${t.key}`}>
                    <bdi>{n}</bdi>
                  </p>
                )}
                {n === 0 && <p>{copy.t('ov.clear')}</p>}
                {n !== undefined && n > 0 && can(me.role, t.cap) && (
                  <Link to={t.to}>{copy.t('open')}</Link>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
