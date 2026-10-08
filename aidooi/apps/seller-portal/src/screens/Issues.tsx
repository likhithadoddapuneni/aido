import { unwrap } from '@aidooi/api-client';
import type { IssueViewSchema } from '@aidooi/contracts';
import {
  Button,
  CursorPagination,
  DataTable,
  DateTime,
  Dialog,
  EmptyState,
  Field,
  FilterBar,
  PageHeader,
  Select,
  StatusPill,
  Textarea,
  useApi,
  useApiMutation,
  useProblemText,
  useToast,
  type Column,
} from '@aidooi/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { z } from 'zod';
import { Guard } from '../components/Guard.tsx';
import { ISSUE_TONE, labelled } from '../components/pills.ts';
import { useS } from '../i18n/index.tsx';
import { usePaged } from '../lib/paged.ts';

type Issue = z.infer<typeof IssueViewSchema>;
type State = Issue['state'];
const STATES: readonly State[] = ['Open', 'Partner Handling', 'Resolved', 'Refunded', 'Rejected'];

/** The role check wraps the content, so a person without access makes none of its data requests. */
export function IssuesScreen() {
  return (
    <Guard action="advanceOrders">
      <IssuesBody />
    </Guard>
  );
}

function IssuesBody() {
  const s = useS();
  const api = useApi();
  const toast = useToast();
  const queries = useQueryClient();
  const problemText = useProblemText();
  const [draft, setDraft] = useState<'' | State>('Open');
  const [applied, setApplied] = useState<'' | State>('Open');
  const [responding, setResponding] = useState<Issue | null>(null);
  const [note, setNote] = useState('');
  const [action, setAction] = useState<'PartnerHandling' | 'Resolved'>('PartnerHandling');

  const { pager, query } = usePaged<Issue>(['issues', applied], (cursor) =>
    unwrap(
      api.http.GET('/v1/seller/issues', {
        params: {
          query: {
            limit: 25,
            ...(cursor ? { cursor } : {}),
            ...(applied ? { state: applied } : {}),
          },
        },
      }),
    ),
  );
  const respond = useApiMutation(
    async (v: { id: string; note: string; action: 'PartnerHandling' | 'Resolved' }) =>
      unwrap(
        api.http.POST('/v1/seller/issues/{id}/respond', {
          params: { path: { id: v.id } },
          body: { note: v.note, action: v.action },
        }),
      ),
    {
      onSuccess: async () => {
        toast.push({ message: s.issueAnswered, tone: 'ok' });
        setResponding(null);
        setNote('');
        await queries.invalidateQueries({ queryKey: ['issues'] });
        await queries.invalidateQueries({ queryKey: ['lines'] });
      },
    },
  );

  const columns: Column<Issue>[] = [
    { id: 'flag', header: s.issue, cell: (i) => <strong>{s.issueFlags[i.flag]}</strong> },
    { id: 'product', header: s.product, cell: (i) => i.productName },
    { id: 'note', header: s.note, cell: (i) => i.note ?? '—' },
    { id: 'raised', header: s.raisedAt, cell: (i) => <DateTime value={i.raisedAt} /> },
    {
      id: 'state',
      header: s.status,
      cell: (i) => (
        <StatusPill status={s.issueStates[i.state]} map={labelled(s.issueStates, ISSUE_TONE)} />
      ),
    },
    {
      id: 'actions',
      header: <span className="ui-visually-hidden">{s.actions}</span>,
      cell: (i) =>
        i.state === 'Open' || i.state === 'Partner Handling' ? (
          <Button
            onClick={() => {
              setResponding(i);
              setAction(i.state === 'Open' ? 'PartnerHandling' : 'Resolved');
            }}
            aria-label={s.fmt('respondFor', { flag: s.issueFlags[i.flag], name: i.productName })}
          >
            {s.respond}
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader title={s.navIssues} description={s.issuesIntro} />
      <FilterBar
        onSubmit={() => {
          pager.reset();
          setApplied(draft);
        }}
        onClear={() => {
          pager.reset();
          setDraft('');
          setApplied('');
        }}
      >
        <Field label={s.status}>
          <Select value={draft} onChange={(e) => setDraft(e.target.value as '' | State)}>
            <option value="">{s.any}</option>
            {STATES.map((st) => (
              <option key={st} value={st}>
                {s.issueStates[st]}
              </option>
            ))}
          </Select>
        </Field>
      </FilterBar>
      <DataTable
        caption={s.navIssues}
        columns={columns}
        rows={query.data?.items ?? []}
        rowKey={(i) => i.id}
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        empty={<EmptyState title={s.noIssues} description={s.noIssuesText} />}
      />
      <CursorPagination
        page={pager.page}
        hasPrevious={pager.hasPrevious}
        nextCursor={query.data?.nextCursor}
        onNext={pager.next}
        onPrevious={pager.previous}
        busy={query.isFetching}
      />
      <Dialog
        open={responding !== null}
        onClose={() => setResponding(null)}
        title={
          responding
            ? s.fmt('respondFor', {
                flag: s.issueFlags[responding.flag],
                name: responding.productName,
              })
            : ''
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setResponding(null)}>
              {s.cancel}
            </Button>
            <Button
              variant="primary"
              loading={respond.isPending}
              disabled={note.trim() === ''}
              onClick={() =>
                responding && respond.mutate({ id: responding.id, note: note.trim(), action })
              }
            >
              {s.send}
            </Button>
          </>
        }
      >
        {responding?.note && (
          <p className="portal-note">
            {s.buyerSaid}: “{responding.note}”
          </p>
        )}
        <Field label={s.yourAction}>
          <Select value={action} onChange={(e) => setAction(e.target.value as typeof action)}>
            <option value="PartnerHandling">{s.actionHandling}</option>
            <option value="Resolved">{s.actionResolved}</option>
          </Select>
        </Field>
        <Field label={s.yourResponse} hint={s.responseHint}>
          <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {respond.error ? (
          <p role="alert" className="portal-error">
            {problemText(respond.error)}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
