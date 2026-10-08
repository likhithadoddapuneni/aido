/**
 * Drives the seller app's own data layer (the same `createApi` + `createSellerData` + session store the
 * screens use) against a running API: sign in → list tasks → confirm one → advance an order line.
 *
 *   node scripts/smoke-server.ts &         # prints the connection JSON
 *   SMOKE='<that json>' node scripts/smoke.ts
 */
import { createHmac } from 'node:crypto';
import { createApi } from '@aidooi/api-client';
import { createSellerData } from '../src/data/seller.ts';
import { createStaffStore, memoryKeyValue } from '../src/session/store.ts';
import { inbox } from '../src/domain/tasks.ts';

interface Target {
  baseUrl: string;
  email: string;
  password: string;
  totpSeed: string;
}
const target = JSON.parse(process.env['SMOKE'] ?? '') as Target;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totp(seed: string, at = Date.now()): string {
  let bits = '';
  for (const c of seed.replace(/=+$/, '').toUpperCase())
    bits += B32.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

const step = (name: string, detail = '') =>
  console.log(`ok  ${name}${detail ? ` — ${detail}` : ''}`);
const store = createStaffStore(memoryKeyValue());
const http = createApi({
  baseUrl: target.baseUrl,
  store,
  appVersion: '1.0.0',
  uuid: () => crypto.randomUUID(),
  onSignedOut: () => undefined,
});
const data = createSellerData(http);

// 1. Sign in. The code used while enrolling is spent; wait for the next 30 s step if the API refuses a reuse.
let session;
for (let attempt = 0; ; attempt++) {
  try {
    session = await data.login({
      email: target.email,
      password: target.password,
      totpCode: totp(target.totpSeed),
    });
    break;
  } catch (e) {
    if (attempt >= 2) throw e;
    await new Promise((r) => setTimeout(r, 31_000));
  }
}
if (session.staff.kind !== 'seller') throw new Error('signed in, but not as a seller');
await store.startLogin(
  { kind: 'user', accessToken: session.accessToken, refreshToken: session.refreshToken },
  {
    id: session.staff.id,
    role: session.staff.role,
    partnerId: session.staff.partnerId,
    email: target.email,
  },
);
step('sign in', `${session.staff.role}`);

// 2. Tasks.
const [viewing, purchase] = await Promise.all([data.viewingTasks(), data.purchaseTasks()]);
const open = inbox(viewing, purchase.tasks, Date.now()).filter((t) => !t.answered);
if (open.length === 0) throw new Error('expected at least one open confirmation task');
step('list tasks', `${open.length} open`);

// 3. Confirm the first one through the endpoint its kind belongs to.
const task = open[0]!;
if (task.kind === 'viewing')
  await data.respondViewing(task.id, { response: 'Confirmed', displayConfirmed: true });
else await data.respondPurchase(task.id, 'Confirmed');
const after = inbox(await data.viewingTasks(), (await data.purchaseTasks()).tasks, Date.now()).find(
  (t) => t.id === task.id,
);
// The API lists only open viewing tasks, so an answered one leaves the list; purchase tasks stay, marked.
if (after && after.answer !== 'Confirmed')
  throw new Error(`task not confirmed: ${JSON.stringify(after)}`);
step('confirm task', `${task.kind} ${task.id}`);

// 4. Advance an order line one step.
const lines = await data.lines({ limit: 10 });
const line = lines.items.find((l) => l.state === 'Confirmed');
if (!line)
  throw new Error(
    `no Confirmed line to advance: ${JSON.stringify(lines.items.map((l) => l.state))}`,
  );
const moved = await data.advance(line.id, { to: 'Preparing' });
if (!moved.changed) throw new Error('advance reported no change');
const again = await data.advance(line.id, { to: 'Preparing' });
if (again.changed) throw new Error('repeating the same advance must be a no-op');
step('advance order line', `${line.id} Confirmed → Preparing (repeat was a no-op)`);

// 5. Sign out on the server.
await data.logout(session.refreshToken);
step('sign out');
console.log('SMOKE PASSED');
