import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ar } from '../src/lib/catalogue.ar.ts';
import { en } from '../src/lib/catalogue.en.ts';
import { checklist, PARTNER_ID, partner, partnerPage, team } from './fixtures.ts';
import { expectNoViolations, LOCALES, problem, renderConsole } from './harness.tsx';

const LIST = { 'GET /v1/ops/partners': { body: partnerPage() } };
const DETAIL = {
  [`GET /v1/ops/partners/${PARTNER_ID}`]: { body: partner() },
  [`GET /v1/ops/partners/${PARTNER_ID}/activation-checklist`]: {
    body: checklist({ commission: true }),
  },
  [`GET /v1/ops/partners/${PARTNER_ID}/team`]: { body: team() },
};

describe('partners list', () => {
  for (const locale of LOCALES) {
    it(`lists partners and passes axe (${locale})`, async () => {
      const c = renderConsole({ path: '/partners', locale, routes: LIST });
      expect(await screen.findByRole('link', { name: 'Al Noor' })).toBeInTheDocument();
      await expectNoViolations(c.container);
    });
  }

  it('searches by status through the API, not in the browser', async () => {
    const c = renderConsole({ path: '/partners', routes: LIST });
    await screen.findByRole('link', { name: 'Al Noor' });
    await c.user.selectOptions(screen.getByLabelText('Status'), 'Active');
    await screen.findByRole('link', { name: 'Al Noor' });
    expect(c.to('GET', '/v1/ops/partners').at(-1)?.query.get('status')).toBe('Active');
  });

  it('creates a partner: percent in the form, whole basis points on the wire', async () => {
    const created = partner({ id: PARTNER_ID });
    const c = renderConsole({
      path: '/partners',
      routes: { ...LIST, ...DETAIL, 'POST /v1/ops/partners': { body: created } },
    });
    await c.user.click(await screen.findByRole('button', { name: 'New partner' }));
    const dlg = await screen.findByRole('dialog');
    await c.user.type(within(dlg).getByLabelText(/Trade name/), 'Desert Home');
    await c.user.type(within(dlg).getByLabelText(/Legal name/), 'Desert Home Trading LLC');
    await c.user.type(within(dlg).getByLabelText(/Commission/), '14.25');
    expect(within(dlg).getByText(/those snapshots never change/)).toBeInTheDocument();
    await c.user.click(within(dlg).getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { name: 'Al Noor', level: 1 });
    expect(c.to('POST', '/v1/ops/partners')[0]?.body).toEqual({
      tradeName: 'Desert Home',
      legalName: 'Desert Home Trading LLC',
      taxRegistrationNo: null,
      afterSalesTerms: null,
      contactEmail: null,
      contactPhone: null,
      commissionBps: 1425,
    });
  });

  it('explains invalid input in words and sends nothing', async () => {
    const c = renderConsole({ path: '/partners', routes: LIST });
    await c.user.click(await screen.findByRole('button', { name: 'New partner' }));
    const dlg = await screen.findByRole('dialog');
    await c.user.type(within(dlg).getByLabelText(/Commission/), '140');
    await c.user.type(within(dlg).getByLabelText(/Contact phone/), '0501234567');
    await c.user.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await within(dlg).findByText(/phone number with country code/)).toBeInTheDocument();
    expect(c.to('POST', '/v1/ops/partners')).toEqual([]);
  });

  it('puts an API field error back on the field it names', async () => {
    const c = renderConsole({
      path: '/partners',
      routes: {
        ...LIST,
        'POST /v1/ops/partners': problem(422, 'validation_failed', [
          { path: 'tradeName', message: 'Already in use' },
        ]),
      },
    });
    await c.user.click(await screen.findByRole('button', { name: 'New partner' }));
    const dlg = await screen.findByRole('dialog');
    await c.user.type(within(dlg).getByLabelText(/Trade name/), 'Al Noor');
    await c.user.type(within(dlg).getByLabelText(/Legal name/), 'Al Noor LLC');
    await c.user.type(within(dlg).getByLabelText(/Commission/), '10');
    await c.user.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect((await within(dlg).findAllByText('Already in use')).length).toBeGreaterThan(0);
  });

  it('hides "New partner" from roles that cannot write', async () => {
    renderConsole({ path: '/partners', role: 'ops_support', routes: LIST });
    await screen.findByRole('link', { name: 'Al Noor' });
    expect(screen.queryByRole('button', { name: 'New partner' })).toBeNull();
  });
});

describe('partner detail', () => {
  for (const locale of LOCALES) {
    it(`shows the checklist, team and commission note, and passes axe (${locale})`, async () => {
      const c = renderConsole({ path: `/partners/${PARTNER_ID}`, locale, routes: DETAIL });
      await screen.findByRole('heading', { name: 'Al Noor', level: 1 });
      const words = locale === 'en' ? en : ar;
      await screen.findByText(words['pt.notReady']);
      if (locale === 'en') {
        // each unmet precondition is named, and the met one is marked done
        expect(screen.getByText('At least one active showroom').closest('li')).toHaveTextContent(
          'Missing',
        );
        expect(screen.getByText('A commission rate is set').closest('li')).toHaveTextContent(
          'Done',
        );
        expect(screen.getByText('Omar Owner')).toBeInTheDocument();
      }
      expect(screen.getAllByText(/14%/).length).toBeGreaterThan(0);
      await expectNoViolations(c.container);
    });
  }

  it('an administrator moves a partner with a reason; Confirm waits for the reason', async () => {
    const c = renderConsole({
      path: `/partners/${PARTNER_ID}`,
      routes: {
        ...DETAIL,
        [`POST /v1/ops/partners/${PARTNER_ID}/transition`]: { body: partner({ status: 'Active' }) },
      },
    });
    await screen.findByText('Not ready to activate yet.');
    await c.user.selectOptions(screen.getByLabelText('Move to'), 'Active');
    await c.user.click(screen.getByRole('button', { name: 'Change status' }));
    const dlg = await screen.findByRole('dialog');
    const confirm = within(dlg).getByRole('button', { name: 'Change status' });
    expect(confirm).toBeDisabled();
    await c.user.type(within(dlg).getByLabelText(/Reason/), 'Agreement signed');
    expect(confirm).toBeEnabled();
    await c.user.click(confirm);
    await screen.findByText('Status changed.');
    expect(c.to('POST', `/v1/ops/partners/${PARTNER_ID}/transition`)[0]?.body).toEqual({
      to: 'Active',
      reason: 'Agreement signed',
      force: false,
    });
  });

  it('only an administrator can pick Inactive and force it', async () => {
    const c = renderConsole({
      path: `/partners/${PARTNER_ID}`,
      routes: {
        ...DETAIL,
        [`GET /v1/ops/partners/${PARTNER_ID}`]: { body: partner({ status: 'Active' }) },
        [`POST /v1/ops/partners/${PARTNER_ID}/transition`]: {
          body: partner({ status: 'Inactive' }),
        },
      },
    });
    await screen.findByText('Not ready to activate yet.');
    await c.user.selectOptions(screen.getByLabelText('Move to'), 'Inactive');
    await c.user.click(screen.getByRole('button', { name: 'Change status' }));
    const dlg = await screen.findByRole('dialog');
    await c.user.click(within(dlg).getByRole('checkbox', { name: /Deactivate even though/ }));
    await c.user.type(within(dlg).getByLabelText(/Reason/), 'Left the platform');
    await c.user.click(within(dlg).getByRole('button', { name: 'Change status' }));
    await screen.findByText('Status changed.');
    expect(c.to('POST', `/v1/ops/partners/${PARTNER_ID}/transition`)[0]?.body).toMatchObject({
      to: 'Inactive',
      force: true,
    });
  });

  it('catalogue staff cannot activate: Active and Inactive are not offered, and the note says why', async () => {
    renderConsole({ path: `/partners/${PARTNER_ID}`, role: 'ops_catalogue', routes: DETAIL });
    await screen.findByText('Not ready to activate yet.');
    expect(
      screen.getByText('Only an administrator can activate or deactivate a partner.'),
    ).toBeInTheDocument();
    const options = within(screen.getByLabelText('Move to'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).not.toContain('Active');
    expect(options).not.toContain('Inactive');
  });

  it('keeps the dialog open and says why when the API refuses the move', async () => {
    const c = renderConsole({
      path: `/partners/${PARTNER_ID}`,
      routes: {
        ...DETAIL,
        [`POST /v1/ops/partners/${PARTNER_ID}/transition`]: problem(
          422,
          'activation_preconditions',
        ),
      },
    });
    await screen.findByText('Not ready to activate yet.');
    await c.user.selectOptions(screen.getByLabelText('Move to'), 'Active');
    await c.user.click(screen.getByRole('button', { name: 'Change status' }));
    const dlg = await screen.findByRole('dialog');
    await c.user.type(within(dlg).getByLabelText(/Reason/), 'Go live');
    await c.user.click(within(dlg).getByRole('button', { name: 'Change status' }));
    expect(await within(dlg).findByText(/cannot be activated yet/)).toBeInTheDocument();
    expect(dlg.textContent).not.toMatch(/activation_preconditions/);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it("invites an owner and resets a seller user's two-step with a reason", async () => {
    const c = renderConsole({
      path: `/partners/${PARTNER_ID}`,
      routes: {
        ...DETAIL,
        [`POST /v1/ops/partners/${PARTNER_ID}/owner-invitation`]: {
          body: { userId: PARTNER_ID, expiresAt: '2026-10-14T00:00:00.000Z' },
        },
        '/v1/ops/seller-users': { body: {} },
      },
    });
    await c.user.click(await screen.findByRole('button', { name: 'Invite the owner' }));
    const dlg = await screen.findByRole('dialog');
    await c.user.type(within(dlg).getByLabelText(/Owner full name/), 'Nadia Owner');
    await c.user.type(within(dlg).getByLabelText(/Owner email/), 'nadia@alnoor.test');
    await c.user.click(within(dlg).getByRole('button', { name: 'Invite the owner' }));
    await screen.findByText(/Invitation sent/);
    expect(c.to('POST', `/v1/ops/partners/${PARTNER_ID}/owner-invitation`)[0]?.body).toEqual({
      fullName: 'Nadia Owner',
      email: 'nadia@alnoor.test',
      phone: null,
      locationId: null,
    });
  });

  it('resets seller two-step only after a reason, and reports the sessions ended', async () => {
    const userId = team().members[0]!.id;
    const c = renderConsole({
      path: `/partners/${PARTNER_ID}`,
      routes: {
        ...DETAIL,
        [`POST /v1/ops/seller-users/${userId}/mfa-reset`]: { body: { revokedSessions: 2 } },
      },
    });
    await c.user.click(await screen.findByRole('button', { name: 'Reset two-step' }));
    const dlg = await screen.findByRole('dialog');
    const confirm = within(dlg).getByRole('button', { name: 'Reset two-step' });
    expect(confirm).toBeDisabled();
    await c.user.type(within(dlg).getByLabelText(/Reason/), 'Lost phone');
    await c.user.click(confirm);
    await screen.findByText('Two-step reset. Sessions ended: 2.');
    expect(c.to('POST', `/v1/ops/seller-users/${userId}/mfa-reset`)[0]?.body).toEqual({
      reason: 'Lost phone',
    });
  });

  it('shows support staff the partner read-only', async () => {
    renderConsole({ path: `/partners/${PARTNER_ID}`, role: 'ops_support', routes: DETAIL });
    await screen.findByRole('heading', { name: 'Al Noor', level: 1 });
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Invite the owner' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset two-step' })).toBeNull();
  });
});
