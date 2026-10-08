import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ar } from '../src/lib/catalogue.ar.ts';
import { en } from '../src/lib/catalogue.en.ts';
import { auditPage, createdRuns, flags, id, RUN_ID, run, runPage, staff } from './fixtures.ts';
import { ME_ID, expectNoViolations, LOCALES, problem, renderConsole } from './harness.tsx';

const RUNS = (items = [run()]) => ({ 'GET /v1/ops/settlement/runs': { body: runPage(items) } });

describe('settlement', () => {
  for (const locale of LOCALES) {
    it(`explains four-eyes up front and passes axe (${locale})`, async () => {
      const words = locale === 'en' ? en : ar;
      const c = renderConsole({ path: '/settlement', role: 'ops_finance', locale, routes: RUNS() });
      await screen.findByText('Al Noor');
      expect(screen.getByText(words['st.fourEyesBody'])).toBeInTheDocument();
      await expectNoViolations(c.container);
    });
  }

  it('prepares runs for a period and reports what is held back', async () => {
    const c = renderConsole({
      path: '/settlement',
      role: 'ops_finance',
      routes: { ...RUNS([]), 'POST /v1/ops/settlement/runs': { body: createdRuns() } },
    });
    await screen.findByText('No runs for this period.');
    const period = screen.getByLabelText(/Period/, { selector: 'form input' });
    await c.user.clear(period);
    await c.user.type(period, '2026-09');
    await c.user.click(screen.getByRole('button', { name: 'Prepare runs for this period' }));
    await screen.findByText('Runs prepared.');
    expect(c.to('POST', '/v1/ops/settlement/runs')[0]?.body).toEqual({ period: '2026-09' });
    const held = await screen.findByRole('table', { name: 'Held back by open issues' });
    expect(held).toHaveTextContent('Al Noor');
  });

  it('rejects a malformed period without calling the API', async () => {
    const c = renderConsole({ path: '/settlement', role: 'ops_finance', routes: RUNS([]) });
    await screen.findByText('No runs for this period.');
    const period = screen.getByLabelText(/Period/, { selector: 'form input' });
    await c.user.clear(period);
    await c.user.type(period, 'September');
    await c.user.click(screen.getByRole('button', { name: 'Prepare runs for this period' }));
    expect(await screen.findByText('This value is not valid.')).toBeInTheDocument();
    expect(c.to('POST', '/v1/ops/settlement/runs')).toEqual([]);
  });

  it('approval needs the period typed, then approves', async () => {
    const c = renderConsole({
      path: '/settlement',
      role: 'ops_finance',
      routes: {
        ...RUNS(),
        [`POST /v1/ops/settlement/runs/${RUN_ID}/approve`]: { body: run({ state: 'Approved' }) },
      },
    });
    await c.user.click(await screen.findByRole('button', { name: 'Approve' }));
    const dlg = await screen.findByRole('dialog');
    const ok = within(dlg).getByRole('button', { name: 'Approve' });
    expect(ok).toBeDisabled();
    await c.user.type(within(dlg).getByRole('textbox'), '2026-09');
    await c.user.click(ok);
    await screen.findByText('Run approved.');
    expect(c.to('POST', `/v1/ops/settlement/runs/${RUN_ID}/approve`)).toHaveLength(1);
  });

  it('the four-eyes refusal is explained in the dialog and the dialog stays open', async () => {
    const c = renderConsole({
      path: '/settlement',
      role: 'ops_finance',
      routes: {
        ...RUNS(),
        [`POST /v1/ops/settlement/runs/${RUN_ID}/approve`]: problem(403, 'forbidden'),
      },
    });
    await c.user.click(await screen.findByRole('button', { name: 'Approve' }));
    const dlg = await screen.findByRole('dialog');
    await c.user.type(within(dlg).getByRole('textbox'), '2026-09');
    await c.user.click(within(dlg).getByRole('button', { name: 'Approve' }));
    expect(await within(dlg).findByText(en['st.fourEyesRefused'])).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('an approved run is paid out with a bank reference', async () => {
    const c = renderConsole({
      path: '/settlement',
      role: 'ops_finance',
      routes: {
        ...RUNS([run({ state: 'Approved', approvedAt: '2026-10-07T08:00:00.000Z' })]),
        [`POST /v1/ops/settlement/runs/${RUN_ID}/mark-paid`]: { body: run({ state: 'Paid' }) },
      },
    });
    await c.user.click(await screen.findByRole('button', { name: 'Mark as paid' }));
    const dlg = await screen.findByRole('dialog');
    const ok = within(dlg).getByRole('button', { name: 'Mark as paid' });
    expect(ok).toBeDisabled();
    await c.user.type(within(dlg).getByLabelText(/Bank reference/), 'FT26280123');
    await c.user.click(ok);
    await screen.findByText('Payout recorded.');
    expect(c.to('POST', `/v1/ops/settlement/runs/${RUN_ID}/mark-paid`)[0]?.body).toEqual({
      bankReference: 'FT26280123',
    });
  });

  it('an administrator can prepare and review but is not offered Approve, and is told why', async () => {
    renderConsole({ path: '/settlement', role: 'ops_admin', routes: RUNS() });
    await screen.findByText('Al Noor');
    expect(screen.getByText(en['st.adminNote'])).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Prepare runs for this period' }),
    ).toBeInTheDocument();
  });

  it('is closed to support and catalogue staff', async () => {
    for (const role of ['ops_support', 'ops_catalogue'] as const) {
      const c = renderConsole({ path: '/settlement', role });
      expect(
        await screen.findByRole('heading', { name: 'You do not have access to this' }),
      ).toBeInTheDocument();
      expect(c.to('GET', '/v1/ops/settlement/runs')).toEqual([]);
      c.unmount();
    }
  });
});

describe('staff', () => {
  const STAFF = { 'GET /v1/ops/staff': { body: staff() } };

  for (const locale of LOCALES) {
    it(`lists staff and passes axe (${locale})`, async () => {
      const c = renderConsole({ path: '/staff', locale, routes: STAFF });
      expect(await screen.findAllByText('Fiona Finance')).not.toHaveLength(0);
      await expectNoViolations(c.container);
    });
  }

  it('marks the signed-in person and invites a colleague with a role', async () => {
    const c = renderConsole({
      path: '/staff',
      routes: {
        ...STAFF,
        'POST /v1/ops/staff': { body: { userId: id(70), expiresAt: '2026-10-14T00:00:00.000Z' } },
      },
    });
    expect(await screen.findByText('Olu Ops (you)')).toBeInTheDocument();
    await c.user.click(screen.getByRole('button', { name: 'Invite a colleague' }));
    const dlg = await screen.findByRole('dialog');
    await c.user.type(within(dlg).getByLabelText(/Full name/), 'Sam Support');
    await c.user.type(within(dlg).getByLabelText(/Email/), 'sam@aidooi.test');
    await c.user.selectOptions(within(dlg).getByLabelText(/Role/), 'ops_finance');
    await c.user.click(within(dlg).getByRole('button', { name: 'Invite a colleague' }));
    await screen.findByText('Invitation sent.');
    expect(c.to('POST', '/v1/ops/staff')[0]?.body).toEqual({
      fullName: 'Sam Support',
      email: 'sam@aidooi.test',
      role: 'ops_finance',
    });
  });

  it('changing a role patches, and a refusal on the last administrator is said in words', async () => {
    const c = renderConsole({
      path: '/staff',
      routes: { ...STAFF, [`PATCH /v1/ops/staff/${ME_ID}`]: problem(409, 'last_admin') },
    });
    await screen.findByText('Olu Ops (you)');
    await c.user.selectOptions(screen.getByLabelText('Role: Olu Ops'), 'ops_support');
    const alert = await screen.findByText(/at least one administrator/i, {
      selector: '[role=alert]',
    });
    expect(alert.textContent).not.toContain('last_admin');
    expect(c.to('PATCH', `/v1/ops/staff/${ME_ID}`)[0]?.body).toEqual({ role: 'ops_support' });
  });

  it('disabling asks first', async () => {
    const other = id(50);
    const c = renderConsole({
      path: '/staff',
      routes: { ...STAFF, [`PATCH /v1/ops/staff/${other}`]: { body: {} } },
    });
    await screen.findByText('Fiona Finance');
    const row = screen.getByText('Fiona Finance').closest('tr')!;
    await c.user.click(within(row).getByRole('button', { name: 'Disable' }));
    const dlg = await screen.findByRole('dialog');
    expect(c.to('PATCH', `/v1/ops/staff/${other}`)).toHaveLength(0);
    await c.user.click(within(dlg).getByRole('button', { name: 'Disable' }));
    await screen.findByText('Staff updated.');
    expect(c.to('PATCH', `/v1/ops/staff/${other}`)[0]?.body).toEqual({ status: 'Disabled' });
  });

  it('resetting two-step needs a reason and shows the sessions ended', async () => {
    const other = id(50);
    const c = renderConsole({
      path: '/staff',
      routes: {
        ...STAFF,
        [`POST /v1/ops/staff/${other}/mfa-reset`]: { body: { revokedSessions: 1 } },
      },
    });
    await screen.findByText('Fiona Finance');
    const row = screen.getByText('Fiona Finance').closest('tr')!;
    await c.user.click(within(row).getByRole('button', { name: 'Reset two-step' }));
    const dlg = await screen.findByRole('dialog');
    const ok = within(dlg).getByRole('button', { name: 'Reset two-step' });
    expect(ok).toBeDisabled();
    await c.user.type(within(dlg).getByLabelText(/Reason/), 'Phone replaced');
    await c.user.click(ok);
    await screen.findByText('Two-step reset. Sessions ended: 1.');
    expect(c.to('POST', `/v1/ops/staff/${other}/mfa-reset`)[0]?.body).toEqual({
      reason: 'Phone replaced',
    });
  });

  it('is administrators only', async () => {
    const c = renderConsole({ path: '/staff', role: 'ops_support' });
    expect(
      await screen.findByRole('heading', { name: 'You do not have access to this' }),
    ).toBeInTheDocument();
    expect(c.to('GET', '/v1/ops/staff')).toEqual([]);
  });
});

describe('audit trail', () => {
  const AUDIT = { 'GET /v1/ops/audit': { body: auditPage() } };

  for (const locale of LOCALES) {
    it(`shows events as a table and as a timeline, and passes axe (${locale})`, async () => {
      const c = renderConsole({ path: '/audit', role: 'ops_support', locale, routes: AUDIT });
      expect(await screen.findByText('Agreement signed')).toBeInTheDocument();
      await c.user.click(
        screen.getByRole('tab', { name: (locale === 'en' ? en : ar)['au.timeline'] }),
      );
      expect(
        await screen.findByRole('list', { name: (locale === 'en' ? en : ar)['au.timeline'] }),
      ).toBeInTheDocument();
      await expectNoViolations(c.container);
    });
  }

  it('applies filters only when submitted, as an instant the API accepts', async () => {
    const c = renderConsole({ path: '/audit', routes: AUDIT });
    await screen.findByText('Agreement signed');
    await c.user.type(screen.getByLabelText('Type of record'), 'partner');
    expect(c.to('GET', '/v1/ops/audit')).toHaveLength(1);
    await c.user.type(screen.getByLabelText('From'), '2026-10-01T09:00');
    await c.user.click(screen.getByRole('button', { name: 'Search' }));
    await vi.waitFor(() => expect(c.to('GET', '/v1/ops/audit')).toHaveLength(2));
    const q = c.to('GET', '/v1/ops/audit').at(-1)!.query;
    expect(q.get('entityType')).toBe('partner');
    expect(q.get('from')).toBe('2026-10-01T05:00:00.000Z'); // 09:00 in Dubai, whatever the test machine's zone
  });

  it('is closed to finance', async () => {
    renderConsole({ path: '/audit', role: 'ops_finance' });
    expect(
      await screen.findByRole('heading', { name: 'You do not have access to this' }),
    ).toBeInTheDocument();
  });
});

describe('feature flags', () => {
  const FLAGS = { 'GET /v1/ops/feature-flags': { body: flags() } };

  for (const locale of LOCALES) {
    it(`lists flags and passes axe (${locale})`, async () => {
      const c = renderConsole({ path: '/flags', locale, routes: FLAGS });
      expect(await screen.findByText('new_checkout')).toBeInTheDocument();
      await expectNoViolations(c.container);
    });
  }

  it('edits a flag with PUT', async () => {
    const c = renderConsole({
      path: '/flags',
      routes: { ...FLAGS, 'PUT /v1/ops/feature-flags/new_checkout': { body: flags().flags[0] } },
    });
    await c.user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dlg = await screen.findByRole('dialog');
    const pct = within(dlg).getByLabelText(/Rollout/);
    await c.user.clear(pct);
    await c.user.type(pct, '75');
    await c.user.click(within(dlg).getByRole('button', { name: 'Save' }));
    await screen.findByText('Flag saved.');
    expect(c.to('PUT', '/v1/ops/feature-flags/new_checkout')[0]?.body).toEqual({
      enabled: true,
      rolloutPct: 75,
      description: 'Staged rollout',
    });
  });

  it('refuses a key that is not lowercase before calling the API', async () => {
    const c = renderConsole({ path: '/flags', routes: FLAGS });
    await c.user.click(await screen.findByRole('button', { name: 'New flag' }));
    const dlg = await screen.findByRole('dialog');
    await c.user.type(within(dlg).getByLabelText(/Key/), 'Bad Key');
    await c.user.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await within(dlg).findByText('This value is not valid.')).toBeInTheDocument();
    expect(c.calls.filter((x) => x.method === 'PUT')).toEqual([]);
  });
});
