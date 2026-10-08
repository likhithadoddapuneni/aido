/**
 * The real API for the end-to-end run: the production app (routes, auth, database, row-level security)
 * on a scratch, migrated and seeded Postgres, with only the outside world faked (payments, media, SMS).
 * It reuses the API's own test harness, so what the browser talks to is what the API tests exercise.
 *
 * Writes `.state.json` (credentials of a real onboarded seller owner, and a fresh authenticator code)
 * before it starts listening, so "the port is open" means "the data is ready".
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onboardStaff, totpNow } from '../../api/test/support/auth-helpers.ts';
import { startHarness } from '../../api/test/support/harness.ts';
import { createOrder } from '../../api/test/support/orders.ts';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env['E2E_API_PORT'] ?? 3190);

const h = await startHarness();
const partnerId = h.seeded?.partners.get('PRT-001');
if (!partnerId) throw new Error('seed has no PRT-001');

const owner = await onboardStaff(h, 'seller', { partnerId, role: 'seller_owner' });
const order = await createOrder(h, { lines: [{ partner: 'PRT-001' }] });
const line = await h.admin
  .selectFrom('fulfilment.order_line as l')
  .innerJoin('catalogue.product as p', 'p.id', 'l.product_id')
  .select(['l.id', 'l.state', 'p.name'])
  .where('l.id', '=', order.lineIds[0] as string)
  .executeTakeFirstOrThrow();

const offer = await h.admin
  .selectFrom('catalogue.seller_offer as o')
  .innerJoin('catalogue.product as p', 'p.id', 'o.product_id')
  .select(['o.id', 'p.name', 'o.seller_sku'])
  .where('o.partner_id', '=', partnerId)
  .orderBy('o.id')
  .limit(1)
  .executeTakeFirstOrThrow();

mkdirSync(resolve(here, '.state'), { recursive: true });
writeFileSync(
  resolve(here, '.state/state.json'),
  JSON.stringify({
    email: owner.email,
    password: owner.password,
    // The harness clock is frozen, and each code is single use: this is the one for the sign-in.
    totpCode: totpNow(h, owner.seed),
    line: { id: line.id, state: line.state, productName: line.name },
    offer: { id: offer.id, productName: offer.name, sku: offer.seller_sku },
  }),
);

await h.app.listen({ port: PORT, host: '127.0.0.1' });
console.log(`e2e API ready on ${PORT}`);

const stop = async () => {
  await h.close();
  process.exit(0);
};
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
