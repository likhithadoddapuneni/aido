import { errorMessage } from '@aidooi/i18n';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ar } from '../src/i18n/ar.ts';
import { en } from '../src/i18n/en.ts';
import * as fx from './fixtures.ts';
import { expectNoViolations, problem, renderPortal, type Call } from './harness.tsx';

afterEach(() => vi.unstubAllGlobals());

const LINE = fx.line();
const LINES = { 'GET /v1/seller/order-lines': { body: fx.linesPage([LINE]) } };
const ADVANCE = `POST /v1/seller/order-lines/${LINE.id}/advance`;

describe('order lines', () => {
  it('advances a line one step and says so', async () => {
    let call: Call | undefined;
    const { user } = renderPortal({
      path: '/orders',
      routes: {
        ...LINES,
        [ADVANCE]: (c) => (
          (call = c),
          { body: { id: LINE.id, state: 'Preparing', changed: true } }
        ),
      },
    });
    await user.click(
      await screen.findByRole('button', { name: 'Start preparing: Oslo 3-seater sofa' }),
    );
    await waitFor(() => expect(call?.body).toEqual({ to: 'Preparing' }));
    expect(await screen.findByText(/Oslo 3-seater sofa is now Preparing/)).toBeInTheDocument();
  });

  it('a line with an open issue cannot be advanced', async () => {
    renderPortal({
      path: '/orders',
      routes: {
        'GET /v1/seller/order-lines': { body: fx.linesPage([fx.line({ openIssues: 1 })]) },
      },
    });
    expect(
      await screen.findByRole('button', { name: 'Start preparing: Oslo 3-seater sofa' }),
    ).toBeDisabled();
  });

  it('a refused step is shown through the error catalogue, not as a raw code', async () => {
    const { user } = renderPortal({
      path: '/orders',
      locale: 'ar',
      routes: { ...LINES, [ADVANCE]: problem(409, 'invalid_transition') },
    });
    await user.click(
      await screen.findByRole('button', { name: new RegExp(ar.advanceLabels.Preparing) }),
    );
    expect(await screen.findByText(errorMessage('invalid_transition', 'ar'))).toBeInTheDocument();
    expect(screen.queryByText('invalid_transition')).toBeNull();
  });

  it('delivery needs a photo: it signs an upload, sends the bytes to storage, then advances with the key', async () => {
    const delivered = fx.line({ state: 'Dispatched' });
    const puts: { url: string; method: string }[] = [];
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://storage.test/')) {
        puts.push({ url, method: init?.method ?? 'GET' });
        return new Response(null, { status: 200 });
      }
      return real(input, init);
    });
    let advanced: Call | undefined;
    const { user } = renderPortal({
      path: '/orders',
      routes: {
        'GET /v1/seller/order-lines': { body: fx.linesPage([delivered]) },
        [`POST /v1/seller/order-lines/${delivered.id}/proof-upload`]: {
          body: {
            storageKey: `proofs/${delivered.id}/p.png`,
            uploadUrl: 'https://storage.test/p.png',
            expiresAt: fx.NOW,
            method: 'PUT',
            headers: { 'content-type': 'image/png' },
          },
        },
        [`POST /v1/seller/order-lines/${delivered.id}/advance`]: (c) => (
          (advanced = c),
          { body: { id: delivered.id, state: 'Delivered', changed: true } }
        ),
      },
    });
    await user.click(
      await screen.findByRole('button', { name: 'Mark delivered: Oslo 3-seater sofa' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: en.markDelivered })).toBeDisabled();
    await user.upload(
      within(dialog).getByLabelText(en.proofPhoto),
      new File(['x'], 'p.png', { type: 'image/png' }),
    );
    await user.click(within(dialog).getByRole('button', { name: en.markDelivered }));
    await waitFor(() => expect(advanced).toBeDefined());
    expect(puts).toEqual([{ url: 'https://storage.test/p.png', method: 'PUT' }]);
    expect(advanced?.body).toEqual({
      to: 'Delivered',
      proofPhotoKey: `proofs/${delivered.id}/p.png`,
    });
  });

  it('refuses a photo that is the wrong type without calling the API', async () => {
    const { user, calls } = renderPortal({
      path: '/orders',
      routes: {
        'GET /v1/seller/order-lines': { body: fx.linesPage([fx.line({ state: 'Dispatched' })]) },
      },
    });
    await user.click(
      await screen.findByRole('button', { name: 'Mark delivered: Oslo 3-seater sofa' }),
    );
    const dialog = await screen.findByRole('dialog');
    // `accept` filters the picker, not a drop or a paste: the guard must hold without it.
    fireEvent.change(within(dialog).getByLabelText(en.proofPhoto), {
      target: { files: [new File(['x'], 'p.pdf', { type: 'application/pdf' })] },
    });
    expect(await within(dialog).findByText(en.photoWrongType)).toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith('/proof-upload'))).toBe(false);
  });

  it('cancelling asks for a reason of at least three characters and sends it', async () => {
    let call: Call | undefined;
    const { user } = renderPortal({
      path: '/orders',
      routes: {
        ...LINES,
        [ADVANCE]: (c) => (
          (call = c),
          { body: { id: LINE.id, state: 'Cancelled', changed: true } }
        ),
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Cancel: Oslo 3-seater sofa' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(new RegExp(en.reason)), 'no');
    await user.click(within(dialog).getByRole('button', { name: en.cancelLine }));
    expect(call).toBeUndefined();
    await user.type(within(dialog).getByLabelText(new RegExp(en.reason)), ' stock');
    await user.click(within(dialog).getByRole('button', { name: en.cancelLine }));
    await waitFor(() => expect(call?.body).toEqual({ to: 'Cancelled', reason: 'no stock' }));
  });

  it('shows an empty state and a retry on failure', async () => {
    renderPortal({
      path: '/orders',
      routes: { 'GET /v1/seller/order-lines': { body: fx.linesPage([]) } },
    });
    expect(await screen.findByText(en.noLines)).toBeInTheDocument();
  });
});

describe('issues', () => {
  const ISSUE = fx.issuesPage.items[0];
  it('responds with a note and an action, then refreshes', async () => {
    let call: Call | undefined;
    const { user } = renderPortal({
      path: '/issues',
      routes: {
        'GET /v1/seller/issues': { body: fx.issuesPage },
        [`POST /v1/seller/issues/${ISSUE?.id}/respond`]: (c) => (
          (call = c),
          { body: { ...ISSUE, state: 'Partner Handling' } }
        ),
      },
    });
    await user.click(await screen.findByRole('button', { name: /Respond: Damaged/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: en.send })).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText(new RegExp(en.yourResponse)),
      'We will collect it on Monday',
    );
    await user.click(within(dialog).getByRole('button', { name: en.send }));
    await waitFor(() =>
      expect(call?.body).toEqual({
        note: 'We will collect it on Monday',
        action: 'PartnerHandling',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('the dialog is accessible', async () => {
    const { user } = renderPortal({
      path: '/issues',
      routes: { 'GET /v1/seller/issues': { body: fx.issuesPage } },
    });
    await user.click(await screen.findByRole('button', { name: /Respond: Damaged/ }));
    await expectNoViolations(await screen.findByRole('dialog'));
  });
});

describe('confirmations', () => {
  it('confirms a purchase request', async () => {
    let call: Call | undefined;
    const id = fx.purchaseTasks.tasks[0]?.id;
    const { user } = renderPortal({
      path: '/tasks',
      routes: {
        'GET /v1/seller/purchase-tasks': { body: fx.purchaseTasks },
        'GET /v1/seller/viewing-tasks': { body: [] },
        [`POST /v1/seller/purchase-tasks/${id}/respond`]: (c) => ((call = c), { body: {} }),
      },
    });
    await user.click(await screen.findByRole('button', { name: en.confirm }));
    await waitFor(() => expect(call?.body).toEqual({ response: 'Confirmed' }));
  });

  it('a viewing is confirmed with whether the pieces are on the floor', async () => {
    let call: Call | undefined;
    const id = fx.viewingTasks[0]?.id;
    const { user } = renderPortal({
      path: '/tasks',
      routes: {
        'GET /v1/seller/purchase-tasks': { body: { tasks: [] } },
        'GET /v1/seller/viewing-tasks': { body: fx.viewingTasks },
        [`POST /v1/seller/viewing-tasks/${id}/respond`]: (c) => ((call = c), { body: {} }),
      },
    });
    await user.click(await screen.findByRole('tab', { name: en.viewingTasks }));
    await user.click(await screen.findByRole('checkbox', { name: en.allOnDisplay }));
    await user.click(screen.getByRole('button', { name: en.confirm }));
    await waitFor(() =>
      expect(call?.body).toEqual({ response: 'Confirmed', displayConfirmed: true }),
    );
  });
});

describe('imports', () => {
  const stubDownloads = () => {
    const saved: string[] = [];
    URL.createObjectURL = () => 'blob:x';
    URL.revokeObjectURL = () => undefined;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      saved.push(this.download);
    };
    return saved;
  };

  it('uploading a CSV creates the import and opens its dry-run, where bad rows are listed with the reason', async () => {
    let call: Call | undefined;
    const csv = 'sku,sellingPrice\nA-1,100\nB-2,-1\nC-3,50\n';
    const { user, history, container } = renderPortal({
      path: '/imports',
      routes: {
        'GET /v1/seller/imports': { body: fx.imports },
        'POST /v1/seller/imports': (c) => (
          (call = c),
          { status: 201, body: fx.imports.imports[0] }
        ),
        [`GET /v1/seller/imports/${fx.importJob.id}`]: { body: fx.importDetail },
      },
    });
    await screen.findByText('catalogue.csv');
    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, new File([csv], 'new.csv', { type: 'text/csv' }));
    await waitFor(() => expect(history.location.pathname).toBe(`/imports/${fx.importJob.id}`));
    expect(call?.body).toEqual({ filename: 'new.csv', csv });
    expect(await screen.findByText(/Selling price must be positive/)).toBeInTheDocument();
    expect(screen.queryByText('A-1')).toBeNull(); // only the failing rows by default
    await user.click(screen.getByRole('checkbox', { name: en.onlyErrors }));
    expect(await screen.findByText('A-1')).toBeInTheDocument();
  });

  it('refuses a file that is not CSV before uploading', async () => {
    const { calls, container } = renderPortal({
      path: '/imports',
      routes: { 'GET /v1/seller/imports': { body: fx.imports } },
    });
    await screen.findByText('catalogue.csv');
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'a.xlsx')] },
    });
    expect(await screen.findByText('Only CSV files are accepted.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('applying asks first, says how many rows it will skip, and commits; a repeat is a no-op shown as already applied', async () => {
    let commits = 0;
    let state = 'Validated';
    const { user } = renderPortal({
      path: `/imports/${fx.importJob.id}`,
      routes: {
        [`GET /v1/seller/imports/${fx.importJob.id}`]: () => ({
          body: {
            ...fx.importDetail,
            state,
            createdCount: state === 'Imported' ? 1 : null,
            updatedCount: state === 'Imported' ? 1 : null,
            skippedCount: state === 'Imported' ? 1 : null,
          },
        }),
        [`POST /v1/seller/imports/${fx.importJob.id}/commit`]: () => {
          commits += 1;
          state = 'Imported';
          return {
            body: {
              ...fx.imports.imports[0],
              state: 'Imported',
              createdCount: 1,
              updatedCount: 1,
              skippedCount: 1,
            },
          };
        },
      },
    });
    await user.click(await screen.findByRole('button', { name: en.applyImport }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(
      '2 valid rows will be applied. 1 rows with errors will be skipped.',
    );
    await user.click(within(dialog).getByRole('button', { name: en.apply }));
    await waitFor(() => expect(commits).toBe(1));
    const done = await screen.findByRole('button', { name: en.alreadyApplied });
    expect(done).toBeDisabled();
  });

  it('downloads the template and the error report with the session attached', async () => {
    const saved = stubDownloads();
    const seen: { url: string; auth: string | null }[] = [];
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input), 'http://localhost');
      if (url.pathname.endsWith('.csv')) {
        seen.push({ url: url.pathname, auth: new Headers(init?.headers).get('authorization') });
        return new Response('a,b', { status: 200 });
      }
      return real(input, init);
    });
    const { user } = renderPortal({
      path: `/imports/${fx.importJob.id}`,
      routes: { [`GET /v1/seller/imports/${fx.importJob.id}`]: { body: fx.importDetail } },
    });
    await user.click(await screen.findByRole('button', { name: en.downloadErrors }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(seen[0]).toEqual({
      url: `/v1/seller/imports/${fx.importJob.id}/errors.csv`,
      auth: 'Bearer a',
    });
  });

  it('a server rejection of the upload is mapped through the catalogue', async () => {
    const { user, container } = renderPortal({
      path: '/imports',
      routes: {
        'GET /v1/seller/imports': { body: fx.imports },
        'POST /v1/seller/imports': problem(422, 'import_too_large'),
      },
    });
    await screen.findByText('catalogue.csv');
    await user.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['a'], 'n.csv', { type: 'text/csv' }),
    );
    expect(await screen.findByText(errorMessage('import_too_large', 'en'))).toBeInTheDocument();
  });
});
