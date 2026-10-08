import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const state = JSON.parse(readFileSync(resolve(here, '.state/state.json'), 'utf8')) as {
  email: string;
  password: string;
  totpCode: string;
  line: { id: string; state: string; productName: string };
  offer: { id: string; productName: string; sku: string };
};

const CSV = [
  'sku,name,type,width_cm,depth_cm,height_cm,primary_colour,primary_style,material,price_aed,stock,delivery_days',
  'E2E-LAMP-1,E2E Floor Lamp One,Floor Lamp,35,35,155,natural,japandi,Wood,250.00,5,4',
  'E2E-LAMP-2,E2E Floor Lamp Two,Floor Lamp,35,35,155,natural,japandi,Wood,not-a-price,5,4',
  'E2E-LAMP-3,E2E Floor Lamp Three,Floor Lamp,35,35,155,natural,japandi,Wood,310.00,2,6',
].join('\r\n');

test('a seller signs in, edits a price, imports a CSV with a bad row, and advances an order line', async ({
  page,
}) => {
  // --- sign in: password + authenticator code ---
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByLabel(/^Email/).fill(state.email);
  await page.getByLabel(/^Password/).fill(state.password);
  await page.getByLabel(/^Authenticator code/).fill(state.totpCode);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Offers' })).toBeVisible();

  // --- edit a price ---
  await page.getByRole('navigation').getByRole('link', { name: 'Offers' }).click();
  await page.getByRole('button', { name: `Edit offer: ${state.offer.productName}` }).click();
  const drawer = page.getByRole('dialog');
  const price = drawer.getByLabel(/^Selling price/);
  await price.fill('1234.50');
  await drawer.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Offer saved.')).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(state.offer.productName) });
  await expect(row).toContainText('AED 1,234.50');

  // --- bulk import with one bad row ---
  await page.getByRole('navigation').getByRole('link', { name: 'Bulk import' }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'e2e.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await expect(page).toHaveURL(/\/imports\/[0-9a-f-]{36}$/);
  const invalid = page.getByRole('row', { name: /E2E-LAMP-2/ });
  await expect(invalid).toContainText('Has errors');
  await expect(invalid.getByText(/price/i)).toBeVisible();
  await page.getByRole('button', { name: 'Apply import' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toContainText(
    '2 valid rows will be applied. 1 rows with errors will be skipped.',
  );
  await confirm.getByRole('button', { name: 'Apply' }).click();
  await expect(
    page.getByRole('button', {
      name: 'This import has already been applied. Applying again changes nothing.',
    }),
  ).toBeDisabled();

  // the two good rows are now offers; the bad one is not
  await page.getByRole('navigation').getByRole('link', { name: 'Offers' }).click();
  await page.getByLabel('Search').fill('E2E Floor Lamp');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('row', { name: /E2E Floor Lamp One/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /E2E Floor Lamp Three/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /E2E Floor Lamp Two/ })).toHaveCount(0);

  // --- advance an order line ---
  await page.getByRole('navigation').getByRole('link', { name: 'Order lines' }).click();
  const line = page.getByRole('row', { name: new RegExp(state.line.productName) });
  await expect(line).toContainText('Confirmed');
  await line.getByRole('button', { name: `Start preparing: ${state.line.productName}` }).click();
  await expect(page.getByText(`${state.line.productName} is now Preparing.`)).toBeVisible();
  // The default view is the work still to do, so the line leaves it...
  await expect(line).toHaveCount(0);
  // ...and is found under its new state, as the API now has it.
  await page.getByLabel('Status').selectOption('Preparing');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('row', { name: new RegExp(state.line.productName) })).toContainText(
    'Preparing',
  );
});
