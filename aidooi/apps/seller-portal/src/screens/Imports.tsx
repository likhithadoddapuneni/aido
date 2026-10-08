import { unwrap } from '@aidooi/api-client';
import type { ImportJobSchema, ImportRowSchema } from '@aidooi/contracts';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  CsvDropzone,
  DataTable,
  DateTime,
  EmptyState,
  KeyValueList,
  PageHeader,
  StatusPill,
  useApi,
  useApiMutation,
  useProblemText,
  useToast,
  type Column,
} from '@aidooi/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, getRouteApi, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { z } from 'zod';
import { Guard } from '../components/Guard.tsx';
import { IMPORT_TONE, labelled } from '../components/pills.ts';
import { useS } from '../i18n/index.tsx';
import { downloadFile } from '../lib/download.ts';

type Job = z.infer<typeof ImportJobSchema>;
type Row = z.infer<typeof ImportRowSchema>;
const MAX_CSV_BYTES = 5 * 1024 * 1024;

/** The role check wraps the content, so a person without access makes none of its data requests. */
export function ImportsScreen() {
  return (
    <Guard action="import">
      <ImportsBody />
    </Guard>
  );
}

function ImportsBody() {
  const s = useS();
  const api = useApi();
  const navigate = useNavigate();
  const problemText = useProblemText();
  const [downloadError, setDownloadError] = useState<unknown>(null);
  const list = useQuery({
    queryKey: ['imports'],
    queryFn: () => unwrap(api.http.GET('/v1/seller/imports')),
  });
  const upload = useApiMutation(
    async (file: File) => {
      const csv = await file.text();
      return unwrap(api.http.POST('/v1/seller/imports', { body: { filename: file.name, csv } }));
    },
    { onSuccess: (job) => void navigate({ to: '/imports/$id', params: { id: job.id } }) },
  );

  const columns: Column<Job>[] = [
    {
      id: 'file',
      header: s.file,
      cell: (j) => (
        <Link to="/imports/$id" params={{ id: j.id }}>
          {j.filename}
        </Link>
      ),
    },
    {
      id: 'state',
      header: s.status,
      cell: (j) => (
        <StatusPill status={s.importStates[j.state]} map={labelled(s.importStates, IMPORT_TONE)} />
      ),
    },
    { id: 'rows', header: s.rows, numeric: true, cell: (j) => j.totalRows ?? '—' },
    { id: 'errors', header: s.errorRows, numeric: true, cell: (j) => j.errorRows ?? '—' },
    { id: 'when', header: s.uploadedAt, cell: (j) => <DateTime value={j.createdAt} /> },
  ];

  return (
    <>
      <PageHeader
        title={s.navImports}
        description={s.importsIntro}
        actions={
          <Button
            onClick={() => {
              setDownloadError(null);
              downloadFile(
                api,
                '/v1/seller/imports/template.csv',
                'aidooi-import-template.csv',
              ).catch(setDownloadError);
            }}
          >
            {s.downloadTemplate}
          </Button>
        }
      />
      {downloadError ? (
        <p role="alert" className="portal-error">
          {problemText(downloadError)}
        </p>
      ) : null}
      <Card title={s.uploadCsv}>
        <p>{s.uploadCsvHelp}</p>
        <CsvDropzone maxBytes={MAX_CSV_BYTES} onFile={(f) => f && upload.mutate(f)} />
        {upload.isPending && <p role="status">{s.validating}</p>}
        {upload.error ? (
          <p role="alert" className="portal-error">
            {problemText(upload.error)}
          </p>
        ) : null}
      </Card>
      <DataTable
        caption={s.previousImports}
        columns={columns}
        rows={list.data?.imports ?? []}
        rowKey={(j) => j.id}
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={s.noImports} description={s.noImportsText} />}
      />
    </>
  );
}

/** The role check wraps the content, so a person without access makes none of its data requests. */
export function ImportDetailScreen() {
  return (
    <Guard action="import">
      <ImportDetailBody />
    </Guard>
  );
}

function ImportDetailBody() {
  const s = useS();
  const api = useApi();
  const toast = useToast();
  const queries = useQueryClient();
  const problemText = useProblemText();
  const { id } = getRouteApi('/authed/imports/$id').useParams();
  const [onlyErrors, setOnlyErrors] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [reportError, setReportError] = useState<unknown>(null);

  const q = useQuery({
    queryKey: ['import', id],
    queryFn: () => unwrap(api.http.GET('/v1/seller/imports/{id}', { params: { path: { id } } })),
  });
  const commit = useApiMutation(
    async () =>
      unwrap(api.http.POST('/v1/seller/imports/{id}/commit', { params: { path: { id } } })),
    {
      onSuccess: async (job) => {
        toast.push({
          message: s.fmt('importDone', {
            created: job.createdCount ?? 0,
            updated: job.updatedCount ?? 0,
          }),
          tone: 'ok',
        });
        await queries.invalidateQueries({ queryKey: ['import', id] });
        await queries.invalidateQueries({ queryKey: ['offers'] });
      },
    },
  );

  const job = q.data;
  const rows: Row[] = (job?.rows ?? []).filter((r) => !onlyErrors || r.status === 'Invalid');
  const valid = (job?.totalRows ?? 0) - (job?.errorRows ?? 0);
  const done = job?.state === 'Imported';
  const columns: Column<Row>[] = [
    { id: 'row', header: s.rowNumber, numeric: true, cell: (r) => r.row },
    { id: 'sku', header: s.sku, cell: (r) => (r.sku ? <bdi>{r.sku}</bdi> : '—') },
    {
      id: 'status',
      header: s.status,
      cell: (r) => (
        <Badge tone={r.status === 'Invalid' ? 'err' : 'ok'}>{s.rowStatus[r.status]}</Badge>
      ),
    },
    {
      id: 'errors',
      header: s.problems,
      cell: (r) =>
        r.errors.length === 0 ? (
          '—'
        ) : (
          <ul className="portal-list">
            {r.errors.map((e) => (
              <li key={`${e.path}:${e.message}`}>
                <strong>{e.path}</strong>: {e.message}
              </li>
            ))}
          </ul>
        ),
    },
  ];

  return (
    <>
      <PageHeader title={job?.filename ?? s.navImports} description={s.importDetailIntro} />
      {job && (
        <Card title={s.summary}>
          <KeyValueList
            items={[
              {
                key: 'state',
                label: s.status,
                value: (
                  <StatusPill
                    status={s.importStates[job.state]}
                    map={labelled(s.importStates, IMPORT_TONE)}
                  />
                ),
              },
              { key: 'total', label: s.rows, value: job.totalRows ?? '—' },
              { key: 'valid', label: s.validRows, value: valid },
              { key: 'errors', label: s.errorRows, value: job.errorRows ?? 0 },
              ...(done
                ? [
                    { key: 'created', label: s.created, value: job.createdCount ?? 0 },
                    { key: 'updated', label: s.updated, value: job.updatedCount ?? 0 },
                    { key: 'skipped', label: s.skipped, value: job.skippedCount ?? 0 },
                  ]
                : []),
            ]}
          />
          <div className="portal-actions">
            {(job.errorRows ?? 0) > 0 && (
              <Button
                onClick={() => {
                  setReportError(null);
                  downloadFile(
                    api,
                    `/v1/seller/imports/${id}/errors.csv`,
                    `import-${id.slice(0, 8)}-errors.csv`,
                  ).catch(setReportError);
                }}
              >
                {s.downloadErrors}
              </Button>
            )}
            <Button
              variant="primary"
              disabled={
                done || valid === 0 || job.state === 'Uploaded' || job.state === 'Validating'
              }
              loading={commit.isPending}
              onClick={() => setConfirm(true)}
            >
              {done ? s.alreadyApplied : job.state === 'Failed' ? s.resumeImport : s.applyImport}
            </Button>
          </div>
          {commit.isPending && <p role="status">{s.applying}</p>}
          {reportError ? (
            <p role="alert" className="portal-error">
              {problemText(reportError)}
            </p>
          ) : null}
          {commit.error ? (
            <p role="alert" className="portal-error">
              {problemText(commit.error)}
            </p>
          ) : null}
          {job.state === 'Failed' && <p className="portal-note">{s.importFailedNote}</p>}
        </Card>
      )}
      <Checkbox
        label={s.onlyErrors}
        checked={onlyErrors}
        onChange={(e) => setOnlyErrors(e.target.checked)}
      />
      <DataTable
        caption={s.importRows}
        columns={columns}
        rows={rows}
        rowKey={(r) => String(r.row)}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        empty={<EmptyState title={onlyErrors ? s.noRowErrors : s.noRows} />}
      />
      <ConfirmDialog
        open={confirm}
        title={s.applyImport}
        description={s.fmt('applyImportText', { valid, invalid: job?.errorRows ?? 0 })}
        confirmLabel={s.apply}
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          await commit.mutateAsync();
          setConfirm(false);
        }}
      />
    </>
  );
}
