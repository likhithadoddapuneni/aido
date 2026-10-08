/**
 * Real-API smoke test for the buyer data layer. Boots the actual API against a scratch Postgres database
 * seeded by `@aidooi/db/testing`, then drives the same services the screens use:
 * guest → project → budgets → recommend → composition → product card → replace → remove → sign in.
 * Every response is parsed with the contract's Zod schema, so a drift between server and app fails here.
 *
 *   pnpm --filter @aidooi/buyer smoke      (needs the local Postgres from `docker compose up postgres`)
 */
import { randomUUID } from 'node:crypto';
import {
  AlternativesSchema,
  BudgetCardsSchema,
  BuyerSessionSchema,
  CompositionSchema,
  GuestSessionResponseSchema,
  ProductCardSchema,
  ProjectSchema,
  RankingSchema,
  RecommendationResponseSchema,
} from '@aidooi/contracts';
import { createApi, memoryStore } from '@aidooi/api-client';
import { startHarness } from '../../api/test/support/harness.ts';
import { discoveryServices } from '../src/api/services.ts';

const POLICY_VERSION = '2026-01';
const PHONE = '+971501234567';

let step = 0;
const ok = (what: string, detail = '') =>
  console.log(`  ${String(++step).padStart(2)}. ${what}${detail ? ` — ${detail}` : ''}`);
function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`smoke failed: ${message}`);
}

const harness = await startHarness();
let failed = false;
try {
  await harness.app.listen({ port: 0, host: '127.0.0.1' });
  const address = harness.app.server.address();
  assert(address && typeof address === 'object', 'server did not bind');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  console.log(`buyer smoke against ${baseUrl} (scratch database ${harness.database.name})`);

  const store = memoryStore();
  const api = createApi({
    baseUrl,
    store,
    appVersion: '0.0.0',
    onSignedOut: () => undefined,
    uuid: randomUUID,
  });
  const svc = discoveryServices(api);

  // 1. Guest session, exactly as the app does on first launch.
  const guest = GuestSessionResponseSchema.parse(await svc.createGuest());
  await store.write({ kind: 'guest', guestToken: guest.guestToken });
  ok('guest session created');

  // 2. A living-room project; the server derives size class and range.
  const project = ProjectSchema.parse(
    await svc.createProject({
      pathId: 'livingRoom',
      lengthM: 5,
      widthM: 4,
      style: 'modern',
      colour: 'grey',
      tier: 'Standard',
    }),
  );
  assert(project.sizeClass === 'Medium', `size class ${project.sizeClass}`);
  ok('project created', `size class ${project.sizeClass} (derived by the server)`);
  ProjectSchema.parse(await svc.getProject(project.id));

  const cards = BudgetCardsSchema.parse(await svc.budgetCards(project.id));
  assert(cards.cards.length === 5, 'five budget tiers');
  ok('budget cards', cards.cards.map((c) => c.tier).join(', '));

  // 3. Recommendation.
  const rec = RecommendationResponseSchema.parse(await svc.recommend(project.id));
  const run = rec.runs[0];
  assert(
    run && run.compositions.length > 0,
    `no compositions (status ${run?.status}, ${run?.reason})`,
  );
  assert(run.compositions.length <= 4, 'at most four options');
  ok(
    'recommendation',
    `${run.status}, ${run.compositions.length} options, best ${run.compositions[0]?.score}`,
  );

  // 4. The room view.
  const first = run.compositions[0]!;
  const composition = CompositionSchema.parse(await svc.getComposition(first.id));
  assert(composition.room !== null, 'room dimensions for the plan');
  assert(composition.items.length > 0, 'composition has items');
  ok(
    'composition',
    `${composition.items.length} items, room ${composition.room.widthCm}×${composition.room.depthCm} cm`,
  );

  // 5. Product card for the first item.
  const item = composition.items[0]!;
  const card = ProductCardSchema.parse(await svc.productCard(item.product.id));
  assert(card.offers.length > 0, 'product card has live offers');
  ok('product card', `${item.product.name}, ${card.offers.length} offer(s)`);

  // 6. Replace: pick the first slot that has an alternative.
  let current = composition;
  let replaced = false;
  for (const it of composition.items) {
    const alts = AlternativesSchema.parse(await svc.alternatives(composition.id, it.slotKey));
    const alt = alts.alternatives[0];
    if (!alt) continue;
    current = CompositionSchema.parse(
      await svc.replaceItem(composition.id, it.slotKey, alt.offer.id),
    );
    const expected = composition.total + alt.priceDelta;
    assert(
      current.total === expected,
      `total ${current.total} after replace, expected ${expected}`,
    );
    ok(
      'replace',
      `${it.slotKey} → ${alt.product.name}, delta ${alt.priceDelta} fils, total ${current.total}`,
    );
    replaced = true;
    break;
  }
  assert(replaced, 'no slot had an alternative to replace with');

  // 7. Remove a non-essential product (an essential one must be refused by the server).
  const essential = current.items.find((i) => i.essential);
  if (essential) {
    const refused = await svc.removeItem(current.id, essential.slotKey).then(
      () => false,
      () => true,
    );
    assert(refused, 'the server must refuse to remove an essential product');
    ok('removing an essential product is refused by the server');
  }
  const optional = current.items.find((i) => !i.essential);
  if (optional) {
    const after = CompositionSchema.parse(await svc.removeItem(current.id, optional.slotKey));
    assert(after.items.length === current.items.length - 1, 'one item fewer');
    assert(after.total < current.total, 'total drops');
    ok(
      'removed a non-essential product',
      `${optional.slotKey}; total ${current.total} → ${after.total}`,
    );
  } else ok('no non-essential product in this room to remove (skipped)');

  // 8. A whole property returns one run per room plus the total.
  const studio = ProjectSchema.parse(
    await svc.createProject({
      pathId: 'fullApartment',
      bedrooms: 2,
      office: false,
      bedroomConsistency: false,
      totalBudgetFils: 8_000_000,
      style: 'modern',
      colour: 'grey',
      tier: 'Standard',
    }),
  );
  const multi = RecommendationResponseSchema.parse(await svc.recommend(studio.id));
  assert(multi.runs.length >= 3 && multi.project !== null, 'per-room runs and a project total');
  ok(
    'full apartment',
    `${multi.runs.length} rooms, total ${multi.project?.bestOverallTotalFils} fils`,
  );

  // 9. An individual product is ranked, not composed.
  const single = ProjectSchema.parse(
    await svc.createProject({
      pathId: 'individualProduct',
      productType: 'Sofa',
      branch: null,
      style: 'modern',
      colour: 'grey',
      tier: 'Standard',
    }),
  );
  const ranking = RankingSchema.parse(await svc.rank(single.id));
  assert(ranking.results.length > 0, 'ranked results');
  ok('individual product ranking', `${ranking.results.length} results`);

  // 10. Sign in with a phone code: the guest's projects follow the buyer.
  await svc.requestOtp(PHONE);
  const session = BuyerSessionSchema.parse(
    await svc.verifyOtp({
      phone: PHONE,
      code: harness.otp.last(PHONE),
      guestToken: guest.guestToken,
      policyVersion: POLICY_VERSION,
    }),
  );
  await store.write({
    kind: 'user',
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  });
  const mine = await svc.listProjects();
  assert(
    mine.some((p) => p.id === project.id),
    'guest project re-owned by the signed-in buyer',
  );
  ok('sign-in upgraded the guest session', `${mine.length} project(s) kept`);

  await svc.logout(session.refreshToken);
  ok('signed out');
  console.log(`\nSMOKE PASSED (${step} steps)`);
} catch (e) {
  failed = true;
  console.error('\nSMOKE FAILED:', e instanceof Error ? (e.stack ?? e.message) : e);
} finally {
  await harness.close();
}
process.exit(failed ? 1 : 0);
