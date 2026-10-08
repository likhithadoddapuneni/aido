import { expect, test } from '@playwright/test';

test('the gallery renders in English and flips to right-to-left Arabic', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'AIDOOi web components' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await page.getByLabel('Language').first().selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});

test('the dialog traps focus and returns it to the opener', async ({ page }) => {
  await page.goto('/');
  const opener = page.getByRole('button', { name: 'Open dialog' });
  await opener.click();
  await expect(page.getByRole('dialog', { name: 'Offer details' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(opener).toBeFocused();
});
