import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadSnapshot } from '../src/modules/catalogue/snapshot.ts';
import { requireApprovedMaps } from '../src/modules/catalogue/compat-maps.ts';
import { runAsSystem } from '../src/context.ts';
import { COMPAT_MAPS, COMPAT_MAP_VERSION, runRecommendation, aed } from '@aidooi/domain';
import { createTestDatabase, fixtures } from '@aidooi/db/testing';
import { seedCatalogue } from '@aidooi/domain/testing';
import { startHarness, type Harness } from './support/harness.ts';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

describe('the platform boots against a real, seeded database', () => {
  it('REGRESSION: every request is authenticated before routing (anonymous → 401, a caller → through)', async () => {
    const anonymous = await h.app.inject('/v1/projects');
    expect(anonymous.statusCode).toBe(401);
    const asGuest = await h.app.inject({
      url: '/v1/projects',
      headers: h.as({
        kind: 'buyer',
        customerId: null,
        guestSessionId: 'a0000000-0000-4000-8000-0000000000f1',
      }),
    });
    expect(asGuest.statusCode).toBe(200);
  });

  it('serves readiness', async () => {
    expect((await h.app.inject('/health/live')).statusCode).toBe(200);
  });

  it('the approved compatibility maps in the database are exactly the ones in the code', async () => {
    const maps = await requireApprovedMaps(h.admin);
    expect(maps.ids.style).toBeTruthy();
  });

  describe('GATE: the engine refuses to run on an unapproved or altered map', () => {
    it('refuses when a map was never activated', async () => {
      const t = await createTestDatabase();
      try {
        const ops = await fixtures.opsUser(t.admin);
        for (const kind of ['style', 'colour', 'material'] as const) {
          await t.admin
            .insertInto('catalogue.compat_map_version')
            .values({
              kind,
              version: COMPAT_MAP_VERSION,
              content: JSON.stringify(COMPAT_MAPS[kind]),
              approved_by: ops,
            })
            .execute();
        }
        await expect(requireApprovedMaps(t.admin)).rejects.toMatchObject({
          code: 'compat_map_not_approved',
        });
      } finally {
        await t.drop();
      }
    });

    it('refuses when the approved content differs from the deployed code (someone edited the map without a new version)', async () => {
      const t = await createTestDatabase();
      try {
        const ops = await fixtures.opsUser(t.admin);
        for (const kind of ['style', 'colour', 'material'] as const) {
          await t.admin
            .insertInto('catalogue.compat_map_version')
            .values({
              kind,
              version: COMPAT_MAP_VERSION,
              content: JSON.stringify(kind === 'colour' ? { tampered: true } : COMPAT_MAPS[kind]),
              approved_by: ops,
              activated_at: new Date(),
            })
            .execute();
        }
        await expect(requireApprovedMaps(t.admin)).rejects.toMatchObject({
          code: 'compat_map_mismatch',
        });
      } finally {
        await t.drop();
      }
    });

    it('approved content is write-once in the database, so approval cannot be quietly rewritten', async () => {
      await expect(
        h.admin
          .updateTable('catalogue.compat_map_version')
          .set({ content: JSON.stringify({ x: 1 }) })
          .where('kind', '=', 'style')
          .execute(),
      ).rejects.toThrow(/write-once/);
    });
  });

  it('a snapshot loaded from the database yields the SAME recommendation as the in-memory seed', async () => {
    const types = [
      'Sofa',
      'Accent Chair',
      'Coffee Table',
      'Side Table',
      'TV Unit',
      'Rug',
      'Floor Lamp',
      'Table Lamp',
      'Wall Art',
      'Vase',
      'Planter',
      'Mirror',
    ];
    const snapshot = await runAsSystem(h.ctx, (trx) => loadSnapshot(trx, types));
    const project = {
      path: 'livingRoom',
      tier: 'Standard',
      style: 'modern',
      colour: 'grey',
      spec: { lengthM: 5, widthM: 4 },
    } as const;
    const fromDb = runRecommendation(project, snapshot);
    const fromSeed = runRecommendation(project, seedCatalogue().catalogue);
    expect(fromDb.status).toBe('Completed');
    // Same products, same offers, same scores — only partner identifiers differ (uuid vs seed code).
    const pick = (r: typeof fromDb) =>
      r.options.map((o) => ({
        k: o.key,
        s: o.valid && o.score,
        t: o.total,
        i: o.items.map((x) => x.offer.id),
      }));
    expect(pick(fromDb)).toEqual(pick(fromSeed));
    expect(fromDb.options[0]?.total).toBeLessThanOrEqual(aed(20_000));
  });

  it('the snapshot only contains what the eligibility view allows', async () => {
    const some = (
      await h.admin
        .selectFrom('catalogue.seller_offer')
        .select('id')
        .where('availability', '=', 'Out of Stock')
        .limit(1)
        .executeTakeFirstOrThrow()
    ).id;
    const productRow = await h.admin
      .selectFrom('catalogue.seller_offer')
      .select('product_id')
      .where('id', '=', some)
      .executeTakeFirstOrThrow();
    const type = (
      await h.admin
        .selectFrom('catalogue.product')
        .select('product_type')
        .where('id', '=', productRow.product_id)
        .executeTakeFirstOrThrow()
    ).product_type;
    const snapshot = await runAsSystem(h.ctx, (trx) => loadSnapshot(trx, [type]));
    expect(snapshot.offers.some((o) => o.id === some)).toBe(false);
  });
});

describe('audit actor types', () => {
  it('every kind of actor maps to a type the audit table accepts', async () => {
    const { auditActor } = await import('../src/http/actor.ts');
    const { recordAudit } = await import('../src/audit.ts');
    const { runAsSystem } = await import('../src/context.ts');
    const actors = [
      { kind: 'buyer', customerId: null, guestSessionId: 'g-1' },
      { kind: 'buyer', customerId: 'c-1', guestSessionId: null },
      {
        kind: 'seller',
        partnerId: 'p',
        sellerUserId: 's-1',
        role: 'seller_owner',
        locationId: null,
      },
      { kind: 'ops', opsUserId: 'o-1', role: 'ops_admin' },
    ] as const;
    expect(actors.map((a) => auditActor(a).type)).toEqual([
      'guest',
      'customer',
      'seller_user',
      'ops_user',
    ]);
    await runAsSystem(h.ctx, async (trx) => {
      for (const a of [...actors, 'system' as const]) {
        await recordAudit(trx, {
          entityType: 'probe',
          entityId: 'x',
          from: null,
          to: 'y',
          actor: a,
        });
      }
    });
  });
});
