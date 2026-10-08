import { unwrap } from '@aidooi/api-client';
import type { StatementSummarySchema } from '@aidooi/contracts';
import {
  Button,
  Card,
  CursorPagination,
  DataTable,
  DateTime,
  EmptyState,
  ErrorState,
  KeyValueList,
  Money,
  PageHeader,
  Spinner,
  StatusPill,
  useApi,
  useProblemText,
  useToast,
  type Column,
} from '@aidooi/ui-web';
import { useQuery } from '@tanstack/react-query';
import { Link, getRouteApi } from '@tanstack/react-router';
import type { z } from 'zod';
import { Guard } from '../components/Guard.tsx';
import { RUN_TONE, labelled } from '../components/pills.ts';
import { useS } from '../i18n/index.tsx';
import { downloadFile } from '../lib/download.ts';
import { usePaged } from '../lib/paged.ts';

type Summary = z.infer<typeof StatementSummarySchema>;

/** The role check wraps the content, so a person without access makes none of its data requests. */
export function StatementsScreen() {
  return (
    <Guard action="viewStatements">
      <StatementsBody />
    </Guard>
  );
}

function StatementsBody() {
  const s = useS();
  const api = useApi();
  const { pager, query } = usePaged<Summary>(['statements'], (cursor) =>
    unwrap(
      api.http.GET('/v1/seller/statements', {
        params: { query: { limit: 25, ...(cursor ? { cursor } : {}) } },
      }),
    ),
  );
  const columns: Column<Summary>[] = [
    {
      id: 'period',
      header: s.period,
      cell: (r) => (
        <Link to="/statements/$id" params={{ id: r.id }}>
          {r.period}
        </Link>
      ),
    },
    { id: 'net', header: s.net, numeric: true, cell: (r) => <Money fils={r.netFils} /> },
    {
      id: 'state',
      header: s.status,
      cell: (r) => (
        <StatusPill status={s.runStates[r.state]} map={labelled(s.runStates, RUN_TONE)} />
      ),
    },
    { id: 'issued', header: s.issuedAt, cell: (r) => <DateTime value={r.issuedAt} /> },
  ];
  return (
    <>
      <PageHeader title={s.navStatements} description={s.statementsIntro} />
      <DataTable
        caption={s.navStatements}
        columns={columns}
        rows={query.data?.items ?? []}
        rowKey={(r) => r.id}
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={<EmptyState title={s.noStatements} description={s.noStatementsText} />}
      />
      <CursorPagination
        page={pager.page}
        hasPrevious={pager.hasPrevious}
        nextCursor={query.data?.nextCursor}
        onNext={pager.next}
        onPrevious={pager.previous}
        busy={query.isFetching}
      />
    </>
  );
}

/** The role check wraps the content, so a person without access makes none of its data requests. */
export function StatementDetailScreen() {
  return (
    <Guard action="viewStatements">
      <StatementDetailBody />
    </Guard>
  );
}

function StatementDetailBody() {
  const s = useS();
  const api = useApi();
  const toast = useToast();
  const problemText = useProblemText();
  const { id } = getRouteApi('/authed/statements/$id').useParams();
  const query = useQuery({
    queryKey: ['statement', id],
    queryFn: async () =>
      unwrap(api.http.GET('/v1/seller/statements/{id}', { params: { path: { id } } })),
  });
  const st = query.data;

  const save = async () => {
    try {
      await downloadFile(
        api,
        `/v1/seller/statements/${id}/csv`,
        `statement-${st?.period ?? id}.csv`,
      );
    } catch (error) {
      toast.push({ message: problemText(error), tone: 'err' });
    }
  };

  return (
    <>
      <PageHeader
        title={st ? s.fmt('statementTitle', { period: st.period }) : s.navStatements}
        actions={
          <Button onClick={() => void save()} disabled={!st}>
            {s.downloadCsv}
          </Button>
        }
      />
      <p>
        <Link to="/statements">{s.backToStatements}</Link>
      </p>
      {query.isPending ? <Spinner /> : null}
      {query.error ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
      {st ? (
        <>
          <Card title={s.summary}>
            <KeyValueList
              items={[
                {
                  key: 'status',
                  label: s.status,
                  value: (
                    <StatusPill
                      status={s.runStates[st.state]}
                      map={labelled(s.runStates, RUN_TONE)}
                    />
                  ),
                },
                { key: 'taxInvoice', label: s.taxInvoice, value: st.taxInvoiceNo ?? '—' },
                { key: 'gross', label: s.gross, value: <Money fils={st.grossFils} /> },
                {
                  key: 'commission',
                  label: s.commission,
                  value: <Money fils={st.commissionFils} />,
                },
                {
                  key: 'adjustments',
                  label: s.adjustments,
                  value: <Money fils={st.adjustmentFils} />,
                },
                { key: 'net', label: s.net, value: <Money fils={st.netFils} /> },
              ]}
            />
          </Card>
          <DataTable
            caption={s.statementLines}
            columns={[
              { id: 'kind', header: s.kind, cell: (l) => s.statementKinds[l.kind] },
              { id: 'product', header: s.product, cell: (l) => l.productName },
              {
                id: 'gross',
                header: s.gross,
                numeric: true,
                cell: (l) => <Money fils={l.grossFils} />,
              },
              {
                id: 'commission',
                header: s.commission,
                numeric: true,
                cell: (l) => <Money fils={l.commissionFils} />,
              },
              { id: 'net', header: s.net, numeric: true, cell: (l) => <Money fils={l.netFils} /> },
            ]}
            rows={st.lines}
            rowKey={(l) => `${l.orderLineId}:${l.kind}`}
            empty={<EmptyState title={s.noStatementLines} />}
          />
        </>
      ) : null}
    </>
  );
}
