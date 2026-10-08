/**
 * Starts the real API (in-process, on a throw-away database) with one onboarded seller owner, one
 * pending viewing confirmation and one paid order line, then prints how to reach it as JSON.
 * It reuses the API's own test harness, so everything behind the HTTP surface is production code over a
 * real PostgreSQL; only the clock, payment gateway and notifier are the harness's fakes.
 *
 *   node scripts/smoke-server.ts          # prints {"baseUrl", "email", "password", "totpSeed"} and keeps running
 */
import { onboardStaff } from '../../api/test/support/auth-helpers.ts';
import { startHarness } from '../../api/test/support/harness.ts';
import { createOrder } from '../../api/test/support/orders.ts';
import { compositionFromRun, key, api, newBuyer } from '../../api/test/support/viewing.ts';

const h = await startHarness();
const buyer = await newBuyer(h);
const mine = await compositionFromRun(h, buyer.id);
const partnerId = mine.items[0]!.partnerId;
const code = [...h.seeded!.partners].find(([, id]) => id === partnerId)?.[0];
if (!code) throw new Error('the composition names a partner the seed does not know');

// A buyer asks to view this partner's items; the seller's confirmation is left pending for the app.

// A showroom is asked only about items it does not already show: take them off display for this scenario.
await h.admin
  .updateTable('catalogue.seller_offer')
  .set({ viewing_status: 'Viewable on Request' })
  .where('partner_id', '=', partnerId)
  .execute();

const slotKeys = mine.items.filter((i) => i.partnerId === partnerId).map((i) => i.slotKey);
const created = await api(
  h,
  'POST',
  '/v1/viewings',
  buyer.actor,
  { compositionId: mine.compositionId, itemSlotKeys: slotKeys },
  key(),
);
if (created.status !== 201) throw new Error(`viewing not created: ${JSON.stringify(created.body)}`);

await createOrder(h, { lines: [{ partner: code }] });
const staff = await onboardStaff(h, 'seller', { partnerId, role: 'seller_owner' });

await h.app.listen({ port: Number(process.env['PORT'] ?? 3900), host: '127.0.0.1' });
const { port } = h.app.server.address() as { port: number };
console.log(
  JSON.stringify({
    baseUrl: `http://127.0.0.1:${port}`,
    email: staff.email,
    password: staff.password,
    totpSeed: staff.seed,
  }),
);
for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => void h.close().then(() => process.exit(0)));
