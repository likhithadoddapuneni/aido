import { unwrap } from '@aidooi/api-client';
import {
  Badge,
  Card,
  DataTable,
  DateTime,
  EmptyState,
  ErrorState,
  KeyValueList,
  PageHeader,
  Skeleton,
  Button,
  useApi,
} from '@aidooi/ui-web';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useCopy } from '../lib/i18n.ts';
import { useCan } from '../shell/Me.tsx';
import { Notice, Status, useAction } from './common.tsx';
import { ReasonConfirm } from './ReasonConfirm.tsx';

type Kind = 'style' | 'colour' | 'material';
type MapStatus = {
  kind: Kind;
  codeVersion: string;
  codeHash: string;
  state: 'approved' | 'unapproved' | 'mismatch' | 'retired';
  versions: {
    version: string;
    hash: string;
    matchesDeployedCode: boolean;
    approvedBy: string;
    activatedAt: string | null;
    retiredAt: string | null;
  }[];
};
type Pending = { kind: Kind; version: string; action: 'approve' | 'retire' };

/**
 * The deployed compatibility maps and the versions people have signed off. The recommendation engine
 * refuses to run until the version in the code is approved, so this screen is the merchandising gate.
 */
export function CompatMapsScreen() {
  const copy = useCopy();
  const api = useApi();
  const canWrite = useCan('maps.write');
  const [pending, setPending] = useState<Pending | null>(null);
  const q = useQuery({
    queryKey: ['compat-maps'],
    queryFn: () => unwrap(api.http.GET('/v1/ops/compat-maps')),
  });
  const approve = useAction(
    (v: { kind: Kind; version: string; reviewNote: string }) =>
      unwrap(
        api.http.POST('/v1/ops/compat-maps/{kind}/approve', {
          params: { path: { kind: v.kind } },
          body: { version: v.version, reviewNote: v.reviewNote },
        }),
      ),
    { success: 'mp.approved.done', invalidate: [['compat-maps']] },
  );
  const retire = useAction(
    (v: { kind: Kind; version: string; reason: string }) =>
      unwrap(
        api.http.POST('/v1/ops/compat-maps/{kind}/retire', {
          params: { path: { kind: v.kind } },
          body: { version: v.version, reason: v.reason },
        }),
      ),
    { success: 'mp.retired.done', invalidate: [['compat-maps']] },
  );
  return (
    <div className="ops-stack">
      <PageHeader title={copy.t('mp.title')} description={copy.t('mp.desc')} />
      {!canWrite && <Notice info>{copy.t('mp.adminOnly')}</Notice>}
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <Skeleton height="12rem" />
      ) : (
        (q.data.maps as MapStatus[]).map((m) => (
          <Card
            key={m.kind}
            title={copy.label('mk', m.kind)}
            actions={
              canWrite && m.state === 'unapproved' ? (
                <Button
                  variant="primary"
                  onClick={() =>
                    setPending({ kind: m.kind, version: m.codeVersion, action: 'approve' })
                  }
                >
                  {copy.t('mp.approve')}
                </Button>
              ) : null
            }
          >
            {m.state === 'mismatch' || m.state === 'retired' ? (
              <Notice>{copy.t('mp.needsRelease')}</Notice>
            ) : null}
            <KeyValueList
              items={[
                {
                  key: 'state',
                  label: copy.t('status'),
                  value: <Status group="ms" value={m.state} />,
                },
                { key: 'ver', label: copy.t('mp.deployed'), value: <bdi>{m.codeVersion}</bdi> },
                {
                  key: 'hash',
                  label: copy.t('mp.hash'),
                  value: <bdi className="ops-mono">{m.codeHash}</bdi>,
                },
              ]}
            />
            <DataTable
              caption={`${copy.label('mk', m.kind)} — ${copy.t('mp.versions')}`}
              rowKey={(v) => v.version}
              rows={m.versions}
              empty={<EmptyState title={copy.t('mp.noVersions')} />}
              columns={[
                { id: 'v', header: copy.t('mp.deployed'), cell: (v) => <bdi>{v.version}</bdi> },
                {
                  id: 'match',
                  header: copy.t('mp.hash'),
                  cell: (v) => (
                    <Badge tone={v.matchesDeployedCode ? 'ok' : 'err'}>
                      {copy.t(v.matchesDeployedCode ? 'mp.matches' : 'mp.differs')}
                    </Badge>
                  ),
                },
                {
                  id: 'act',
                  header: copy.t('mp.activated'),
                  cell: (v) =>
                    v.activatedAt ? <DateTime value={v.activatedAt} /> : copy.t('none'),
                },
                {
                  id: 'ret',
                  header: copy.t('mp.retired'),
                  cell: (v) => (v.retiredAt ? <DateTime value={v.retiredAt} /> : copy.t('none')),
                },
                {
                  id: 'a',
                  header: copy.t('actions'),
                  cell: (v) =>
                    canWrite && !v.retiredAt ? (
                      <Button
                        onClick={() =>
                          setPending({ kind: m.kind, version: v.version, action: 'retire' })
                        }
                      >
                        {copy.t('mp.retire')}
                      </Button>
                    ) : null,
                },
              ]}
            />
          </Card>
        ))
      )}
      <ReasonConfirm
        open={pending !== null}
        danger={pending?.action === 'retire'}
        title={
          pending
            ? copy.t(pending.action === 'approve' ? 'mp.approveTitle' : 'mp.retireTitle', {
                kind: copy.label('mk', pending.kind),
              })
            : ''
        }
        description={copy.t(pending?.action === 'retire' ? 'mp.retireBody' : 'mp.approveBody')}
        confirmLabel={copy.t(pending?.action === 'retire' ? 'mp.retire' : 'mp.approve')}
        requireWord={pending?.version}
        onConfirm={async (note) => {
          if (!pending) return;
          if (pending.action === 'approve') {
            await approve.mutateAsync({
              kind: pending.kind,
              version: pending.version,
              reviewNote: note,
            });
          } else {
            await retire.mutateAsync({
              kind: pending.kind,
              version: pending.version,
              reason: note,
            });
          }
        }}
        onClose={() => setPending(null)}
      />
    </div>
  );
}
