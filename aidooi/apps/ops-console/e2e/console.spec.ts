import { expect, test, type Page } from '@playwright/test';

const STATE = 'http://127.0.0.1:3101';

interface State {
  accounts: Record<string, { email: string; password: string }>;
  productId: string;
  productName: string;
  partnerName: string;
  period: string;
}

async function signIn(page: Page, who: string, state: State) {
  const { code } = (await (await fetch(`${STATE}/totp?user=${who}`)).json()) as { code: string };
  const a = state.accounts[who]!;
  await page.goto('/');
  await page.getByLabel(/Email/).fill(a.email);
  await page.getByLabel(/Password/).fill(a.password);
  await page.getByLabel(/Authenticator code/).fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: /Account:/ }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

let state: State;
test.beforeAll(async () => {
  state = (await (await fetch(`${STATE}/state`)).json()) as State;
});

test('an administrator approves the compatibility map and verifies a product', async ({ page }) => {
  await signIn(page, 'admin', state);

  // The seeded queue shows up on the overview.
  await expect(page.getByTestId('tile-verificationQueue')).toHaveText('1');

  // --- compatibility map: nobody has approved "style" yet ---
  await page.getByRole('link', { name: 'Compatibility maps' }).click();
  const style = page.getByRole('region', { name: 'Style' });
  await expect(style.getByText('Not approved')).toBeVisible();
  await style.getByRole('button', { name: 'Approve this version' }).click();
  const dlg = page.getByRole('dialog');
  const confirm = dlg.getByRole('button', { name: 'Approve this version' });
  await expect(confirm).toBeDisabled();
  await dlg.getByLabel(/Reason/).fill('Reviewed with merchandising');
  const version = (await style.locator('dd bdi').first().textContent())!.trim();
  await dlg.getByRole('textbox', { name: new RegExp(version) }).fill(version);
  await confirm.click();
  await expect(page.getByText('Map approved.')).toBeVisible();
  await expect(style.getByText('Approved and active')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve this version' })).toHaveCount(0);

  // --- product verification ---
  await page.getByRole('link', { name: 'Product verification' }).click();
  await page.getByRole('link', { name: new RegExp(state.productName) }).click();
  await expect(page.getByRole('heading', { name: state.productName, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('Product verified.')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Verify', exact: true })).toBeDisabled();

  // The queue is now empty, and the overview agrees.
  await page.getByRole('link', { name: 'Overview' }).click();
  await expect(page.getByTestId('tile-verificationQueue')).toHaveText('0');

  // An administrator can review settlement but is not offered the approval.
  await page.getByRole('link', { name: 'Settlement' }).click();
  await expect(page.getByText(/Administrators can prepare and review runs/)).toBeVisible();
  await signOut(page);
});

test('finance prepares a run; it cannot approve its own, a second finance user can', async ({
  page,
}) => {
  // --- first finance user prepares the run ---
  await signIn(page, 'finance1', state);
  await page.getByRole('link', { name: 'Settlement' }).click();
  await page
    .getByLabel(/Period/, { exact: false })
    .first()
    .fill(state.period);
  await page.getByRole('button', { name: 'Prepare runs for this period' }).click();
  await expect(page.getByText('Runs prepared.')).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(state.partnerName) });
  await expect(row).toContainText('Draft');
  // AED 1,000 sold, 10% commission (AED 100) → AED 900 net, as the API computed it
  await expect(row).toContainText('AED 1,000');
  await expect(row).toContainText('AED 100');
  await expect(row).toContainText('AED 900');

  // --- four-eyes: the person who prepared it is refused, and told why ---
  await row.getByRole('button', { name: 'Approve' }).click();
  let dlg = page.getByRole('dialog');
  await dlg.getByRole('textbox').fill(state.period);
  await dlg.getByRole('button', { name: 'Approve' }).click();
  await expect(
    dlg.getByText('You prepared this run, so someone else in finance must approve it.'),
  ).toBeVisible();
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await expect(row).toContainText('Draft');
  await signOut(page);

  // --- second finance user approves, then records the payout ---
  await signIn(page, 'finance2', state);
  await page.getByRole('link', { name: 'Settlement' }).click();
  await page
    .getByLabel(/Period/)
    .first()
    .fill(state.period);
  const run = page.getByRole('row', { name: new RegExp(state.partnerName) });
  await expect(run).toContainText('Draft');
  await run.getByRole('button', { name: 'Approve' }).click();
  dlg = page.getByRole('dialog');
  await dlg.getByRole('textbox').fill(state.period);
  await dlg.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Run approved.')).toBeVisible();
  await expect(run).toContainText('Approved');

  await run.getByRole('button', { name: 'Mark as paid' }).click();
  dlg = page.getByRole('dialog');
  await dlg.getByLabel(/Bank reference/).fill('FT26280123');
  await dlg.getByRole('button', { name: 'Mark as paid' }).click();
  await expect(page.getByText('Payout recorded.')).toBeVisible();
  await expect(run).toContainText('Paid');
  await expect(run).toContainText('FT26280123');

  // Finance has no staff screen: the route says so instead of showing it.
  await page.goto('/staff');
  await expect(page.getByRole('heading', { name: 'You do not have access to this' })).toBeVisible();
});

test('a visitor with no session is sent to sign-in, never shown a screen', async ({ page }) => {
  await page.goto('/staff');
  // No session in this fresh browser context: sign-in comes first, never the screen.
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
