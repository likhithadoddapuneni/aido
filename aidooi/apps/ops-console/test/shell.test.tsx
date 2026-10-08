import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { can, OPS_ROLES, type Capability, type OpsRole } from '../src/lib/roles.ts';
import { expectNoViolations, LOCALES, navLabels, problem, renderConsole } from './harness.tsx';
import { overview } from './fixtures.ts';

const BASE = { 'GET /v1/ops/overview': { body: overview() } };

/** What each role's navigation must show, in order. This is the UI half of the API's role matrix. */
const NAV: Record<OpsRole, string[]> = {
  ops_admin: [
    'Overview',
    'Partners',
    'Product verification',
    'Compatibility maps',
    'Orders',
    'Viewings',
    'Issues',
    'Settlement',
    'Staff',
    'Audit trail',
    'Feature flags',
  ],
  ops_catalogue: ['Overview', 'Partners', 'Product verification', 'Compatibility maps'],
  ops_support: ['Overview', 'Partners', 'Orders', 'Viewings', 'Issues', 'Audit trail'],
  ops_finance: ['Overview', 'Partners', 'Orders', 'Viewings', 'Settlement'],
};

describe('role gating', () => {
  for (const role of OPS_ROLES) {
    it(`${role} sees exactly its navigation`, async () => {
      renderConsole({ role, routes: BASE });
      await screen.findByRole('heading', { name: 'Overview', level: 1 });
      expect(navLabels()).toEqual(NAV[role]);
    });
  }

  it('the capability table keeps approving money for finance alone', () => {
    const who = (cap: Capability) => OPS_ROLES.filter((r) => can(r, cap));
    expect(who('settlement.approve')).toEqual(['ops_finance']);
    expect(who('maps.write')).toEqual(['ops_admin']);
    expect(who('partners.activate')).toEqual(['ops_admin']);
    expect(who('staff')).toEqual(['ops_admin']);
    expect(who('flags')).toEqual(['ops_admin']);
    expect(can(undefined, 'overview')).toBe(false);
    expect(can('seller_owner', 'overview')).toBe(false);
  });

  const BLOCKED: [OpsRole, string][] = [
    ['ops_catalogue', '/staff'],
    ['ops_catalogue', '/orders'],
    ['ops_support', '/products'],
    ['ops_support', '/settlement'],
    ['ops_finance', '/issues'],
    ['ops_finance', '/audit'],
    ['ops_finance', '/flags'],
  ];
  for (const [role, path] of BLOCKED) {
    it(`${role} opening ${path} is told why, and no request is made`, async () => {
      const c = renderConsole({ role, path, routes: BASE });
      expect(
        await screen.findByRole('heading', { name: 'You do not have access to this' }),
      ).toBeInTheDocument();
      expect(c.calls.filter((x) => x.path !== '/v1/me' && x.path !== '/v1/ops/overview')).toEqual(
        [],
      );
    });
  }
});

describe('front door', () => {
  it('shows the sign-in page without a session', async () => {
    renderConsole({ signedIn: false });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Authenticator code/)).toBeInTheDocument();
  });

  it('turns away a seller account that signs in here', async () => {
    renderConsole({ role: 'seller_owner' });
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('maps an API failure on the overview to words with the reference, never a raw code', async () => {
    renderConsole({
      routes: {
        'GET /v1/ops/overview': {
          ...problem(500, 'internal_error'),
          body: { status: 500, code: 'internal_error', correlationId: 'corr-77' },
        },
      },
    });
    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent('internal_error');
    expect(alert).toHaveTextContent('corr-77');
  });
});

describe('overview', () => {
  for (const locale of LOCALES) {
    it(`renders its tiles and passes axe (${locale})`, async () => {
      const c = renderConsole({ locale, routes: BASE });
      expect(await screen.findByTestId('tile-verificationQueue')).toHaveTextContent('4');
      expect(screen.getByTestId('tile-settlementRunsAwaitingApproval')).toHaveTextContent('3');
      expect(document.documentElement.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      expect(document.documentElement.lang).toBe(locale);
      await expectNoViolations(c.container);
    });
  }

  it('offers a link only where this role can act', async () => {
    renderConsole({ role: 'ops_finance', routes: BASE });
    await screen.findByTestId('tile-openIssues');
    // finance cannot open Issues, but can open Settlement
    const issuesCard = screen.getByTestId('tile-openIssues').closest('section, div')!;
    expect(issuesCard.querySelector('a')).toBeNull();
  });
});
