import { errorMessage } from '@aidooi/i18n';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ar } from '../src/i18n/ar.ts';
import { en } from '../src/i18n/en.ts';
import * as fx from './fixtures.ts';
import { expectNoViolations, problem, renderPortal, type Call } from './harness.tsx';

const CATALOGUE = { en, ar };

const base = {
  'GET /v1/seller/offers': { body: fx.offersPage() },
  'GET /v1/seller/offers/AIO-00000001': { body: fx.offer() },
  'GET /v1/seller/locations': { body: fx.locations },
};

const openEditor = async (
  user: ReturnType<typeof renderPortal>['user'],
  name = 'Oslo 3-seater sofa',
) => {
  await user.click(await screen.findByRole('button', { name: `Edit offer: ${name}` }));
  return screen.findByRole('dialog');
};

describe('offers', () => {
  it('lists offers with the filters sent to the API as a query', async () => {
    const { user, calls } = renderPortal({ path: '/offers', routes: base });
    await screen.findByText('Oslo 3-seater sofa');
    await user.type(screen.getByLabelText('Search'), 'oslo');
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/v1/seller/offers' && c.query.get('q') === 'oslo')).toBe(
        true,
      ),
    );
  });

  it('a manager edits the price: dirhams become fils and the version travels with the change', async () => {
    let patch: Call | undefined;
    const { user } = renderPortal({
      path: '/offers',
      role: 'seller_manager',
      routes: {
        ...base,
        'PATCH /v1/seller/offers/AIO-00000001': (c) => {
          patch = c;
          return { body: fx.offer({ sellingPrice: 229_950, version: 5 }) };
        },
      },
    });
    const dialog = await openEditor(user);
    const price = await within(dialog).findByLabelText(/selling price/i);
    await user.clear(price);
    await user.type(price, '2299.50');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toBeDefined());
    expect(patch?.body).toEqual({ expectedVersion: 4, sellingPrice: 229_950 });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('staff can change stock but are not offered the price field, and send no price', async () => {
    let patch: Call | undefined;
    const { user } = renderPortal({
      path: '/offers',
      role: 'seller_staff',
      routes: {
        ...base,
        'PATCH /v1/seller/offers/AIO-00000001': (c) => {
          patch = c;
          return { body: fx.offer({ stockQty: 6, version: 5 }) };
        },
      },
    });
    const dialog = await openEditor(user);
    expect(within(dialog).queryByLabelText(/selling price/i)).toBeNull();
    const stock = await within(dialog).findByLabelText(/stock quantity/i);
    await user.clear(stock);
    await user.type(stock, '6');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toBeDefined());
    expect(patch?.body).toEqual({ expectedVersion: 4, stockQty: 6 });
  });

  it('a stale version shows the conflict banner, blocks saving, and reload fetches the latest', async () => {
    let gets = 0;
    const { user } = renderPortal({
      path: '/offers',
      role: 'seller_manager',
      routes: {
        ...base,
        'GET /v1/seller/offers/AIO-00000001': () => {
          gets += 1;
          return {
            body: fx.offer({
              version: gets === 1 ? 4 : 5,
              sellingPrice: gets === 1 ? 249_900 : 239_900,
            }),
          };
        },
        'PATCH /v1/seller/offers/AIO-00000001': problem(409, 'offer_version_conflict'),
      },
    });
    const dialog = await openEditor(user);
    const price = await within(dialog).findByLabelText(/selling price/i);
    await user.clear(price);
    await user.type(price, '2000');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(/someone else changed this offer/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Reload' }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText(/selling price/i)).toHaveValue('2399'),
    );
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it.each(['en', 'ar'] as const)(
    'stock below reserved explains itself in %s through the shared error catalogue',
    async (locale) => {
      const { user } = renderPortal({
        path: '/offers',
        locale,
        role: 'seller_staff',
        routes: {
          ...base,
          'PATCH /v1/seller/offers/AIO-00000001': problem(409, 'stock_below_reserved'),
        },
      });
      await user.click(await screen.findByRole('button', { name: /Oslo 3-seater sofa/ }));
      const dialog = await screen.findByRole('dialog');
      await waitFor(() =>
        expect(dialog.querySelector('input[inputmode="numeric"]')).not.toBeNull(),
      );
      const stock = dialog.querySelector<HTMLInputElement>(
        'input[inputmode="numeric"]',
      ) as HTMLInputElement;
      await user.clear(stock);
      await user.type(stock, '1');
      await user.click(within(dialog).getByRole('button', { name: CATALOGUE[locale].save }));
      const texts = await within(dialog).findAllByText(
        errorMessage('stock_below_reserved', locale),
      );
      expect(texts.length).toBeGreaterThan(0);
      await expectNoViolations(dialog);
    },
  );

  it('reserved stock is explained next to the stock field', async () => {
    const { user } = renderPortal({ path: '/offers', role: 'seller_staff', routes: base });
    const dialog = await openEditor(user);
    expect(await within(dialog).findByText(/3 units are reserved/)).toBeInTheDocument();
  });
});
