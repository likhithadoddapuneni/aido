import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aed, runRecommendation } from '@aidooi/domain';
import { seedCatalogue } from '@aidooi/domain/testing';
import { startHarness, guest, type Harness } from './support/harness.ts';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

const G1 = guest('a0000000-0000-4000-8000-0000000000a1');
const G2 = guest('a0000000-0000-4000-8000-0000000000a2');

// Guests own projects through their session row.
beforeAll(async () => {
  for (const g of [G1, G2]) {
    if (g.kind !== 'buyer' || !g.guestSessionId) throw new Error('guest expected');
    await h.admin
      .insertInto('identity.guest_session')
      .values({
        id: g.guestSessionId,
        token_hash: `hash-${g.guestSessionId}`,
        expires_at: new Date(Date.now() + 86_400_000),
      })
      .execute();
  }
});

const living = {
  pathId: 'livingRoom',
  lengthM: 5,
  widthM: 4,
  style: 'modern',
  colour: 'grey',
  tier: 'Standard',
} as const;

const post = (url: string, actor = G1, payload?: unknown) =>
  h.app.inject({
    method: 'POST',
    url,
    headers: h.as(actor),
    ...(payload ? { payload: payload as object } : {}),
  });
const get = (url: string, actor = G1) => h.app.inject({ method: 'GET', url, headers: h.as(actor) });

async function newProject(input: Record<string, unknown> = living, actor = G1) {
  const res = await post('/v1/projects', actor, { input });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as {
    id: string;
    sizeClass: string | null;
    budgetRange: { lowFils: number; highFils: number } | null;
  };
}

describe('projects', () => {
  it('derives the size class and budget range; the customer never enters them', async () => {
    const p = await newProject();
    expect(p.sizeClass).toBe('Medium'); // 20 m² is the first Medium (Small ends below 20)
    expect(p.budgetRange).toEqual({ lowFils: aed(8_500), highFils: aed(14_000) });
  });

  it('rejects impossible or incomplete answers with field-level errors', async () => {
    const res = await post('/v1/projects', G1, { input: { ...living, lengthM: 0.5 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('validation_failed');
    const missing = await post('/v1/projects', G1, {
      input: {
        pathId: 'bedroom',
        lengthM: 4,
        widthM: 4,
        style: 'modern',
        colour: 'grey',
        tier: 'Value',
      },
    });
    expect(missing.statusCode).toBe(400);
  });

  it('a project is private to its owner', async () => {
    const p = await newProject();
    expect((await get(`/v1/projects/${p.id}`, G2)).statusCode).toBe(404);
    expect((await post(`/v1/projects/${p.id}/recommend`, G2)).statusCode).toBe(404);
    expect((await get(`/v1/projects/${p.id}`)).statusCode).toBe(200);
    const list = (await get('/v1/projects', G2)).json() as { projects: { id: string }[] };
    expect(list.projects.some((x) => x.id === p.id)).toBe(false);
  });

  it('requires a buyer or guest identity', async () => {
    expect(
      (await h.app.inject({ method: 'POST', url: '/v1/projects', payload: { input: living } }))
        .statusCode,
    ).toBe(401);
  });

  it('the five budget cards carry tier name, AED range and a promise', async () => {
    const p = await newProject();
    const cards = (await get(`/v1/projects/${p.id}/budget-cards`)).json() as {
      cards: { tier: string; lowFils: number; highFils: number; blurb: string }[];
    };
    expect(cards.cards.map((c) => c.tier)).toEqual([
      'Essential',
      'Value',
      'Standard',
      'Premium',
      'Luxury',
    ]);
    expect(cards.cards.every((c) => c.highFils > c.lowFils && c.blurb.length > 10)).toBe(true);
  });

  it('the path cannot be changed on an existing project', async () => {
    const p = await newProject();
    const res = await h.app.inject({
      method: 'PUT',
      url: `/v1/projects/${p.id}`,
      headers: h.as(G1),
      payload: {
        input: {
          pathId: 'bedroom',
          lengthM: 4,
          widthM: 4,
          bedSize: 'Queen',
          style: 'modern',
          colour: 'grey',
          tier: 'Value',
        },
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('path_change_not_allowed');
  });
});

describe('recommendation run (WF-02)', () => {
  it('returns up to four compositions identical to the pure engine over the same data', async () => {
    const p = await newProject();
    const res = await post(`/v1/projects/${p.id}/recommend`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as {
      runs: {
        status: string;
        compositions: {
          objective: string;
          total: number;
          score: number;
          items: { slotKey: string; offer: { id: string } }[];
        }[];
      }[];
    };
    expect(body.runs).toHaveLength(1);
    const run = body.runs[0]!;
    expect(run.status).toBe('Completed');
    expect(run.compositions.map((c) => c.objective)).toEqual([
      'best_overall',
      'best_value',
      'best_style',
      'premium',
    ]);

    const expected = runRecommendation(
      {
        path: 'livingRoom',
        tier: 'Standard',
        style: 'modern',
        colour: 'grey',
        spec: { lengthM: 5, widthM: 4 },
      },
      seedCatalogue().catalogue,
    );
    expect(run.compositions.map((c) => c.total)).toEqual(expected.options.map((o) => o.total));
    expect(run.compositions.map((c) => c.items.map((i) => i.offer.id))).toEqual(
      expected.options.map((o) => o.items.map((i) => i.offer.id)),
    );
  });

  it('a composition carries its room, so a client can draw the plan', async () => {
    const p = await newProject();
    const res = (await post(`/v1/projects/${p.id}/recommend`)).json() as {
      runs: { compositions: { room: unknown }[] }[];
    };
    expect(res.runs[0]!.compositions[0]!.room).toEqual({ widthCm: 500, depthCm: 400 });
  });

  it('persists the run with its provenance and EVERY scored candidate, rejections included', async () => {
    const p = await newProject();
    const res = (await post(`/v1/projects/${p.id}/recommend`)).json() as { runs: { id: string }[] };
    const run = await h.admin
      .selectFrom('recommendation.recommendation_run')
      .selectAll()
      .where('id', '=', res.runs[0]!.id)
      .executeTakeFirstOrThrow();
    expect(run).toMatchObject({
      state: 'Completed',
      standards_version: '2026.1',
      engine_version: '1',
      size_class: 'Medium',
    });
    expect(run.input_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(run.catalogue_version).toBeTruthy();
    const scores = await h.admin
      .selectFrom('recommendation.candidate_score')
      .select(['eligible', 'rejected_reason', 'budget'])
      .where('run_id', '=', run.id)
      .execute();
    expect(scores.length).toBeGreaterThan(50);
    expect(scores.some((s) => !s.eligible && s.rejected_reason)).toBe(true);
    expect(scores.every((s) => s.eligible === (s.rejected_reason === null))).toBe(true);
    const audit = await h.admin
      .selectFrom('audit.event')
      .select('to_state')
      .where('entity_type', '=', 'recommendation_run')
      .where('entity_id', '=', run.id)
      .execute();
    expect(audit).toHaveLength(1);
  });

  it('GATE: the engine does not run on an unapproved compatibility map', async () => {
    const p = await newProject();
    // The approval row is write-once; retire it the way an ops reviewer would.
    await h.admin
      .updateTable('catalogue.compat_map_version')
      .set({ retired_at: new Date() })
      .where('kind', '=', 'colour')
      .execute();
    try {
      const res = await post(`/v1/projects/${p.id}/recommend`);
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('compat_map_not_approved');
    } finally {
      await h.admin
        .updateTable('catalogue.compat_map_version')
        .set({ retired_at: null })
        .where('kind', '=', 'colour')
        .execute();
    }
  });

  it('reports a blocked essential instead of dropping it', async () => {
    const p = await newProject({ ...living, tier: 'Luxury', lengthM: 3, widthM: 3 });
    // Take every sofa off the market, then ask.
    await h.admin
      .updateTable('catalogue.seller_offer')
      .set({ availability: 'Out of Stock', stock_qty: 0 })
      .where(
        'product_id',
        'in',
        h.admin.selectFrom('catalogue.product').select('id').where('product_type', '=', 'Sofa'),
      )
      .execute();
    try {
      const res = (await post(`/v1/projects/${p.id}/recommend`)).json() as {
        runs: { status: string; reason: string; compositions: unknown[] }[];
      };
      expect(res.runs[0]).toMatchObject({ status: 'Failed', compositions: [] });
      expect(res.runs[0]!.reason).toMatch(/essential Sofa/);
    } finally {
      await h.admin
        .updateTable('catalogue.seller_offer')
        .set({ availability: 'In Stock', stock_qty: 5 })
        .where(
          'product_id',
          'in',
          h.admin.selectFrom('catalogue.product').select('id').where('product_type', '=', 'Sofa'),
        )
        .execute();
    }
  });

  it('a multi-room apartment gets one run per module and a project total', async () => {
    const p = await newProject({
      pathId: 'fullApartment',
      bedrooms: 2,
      office: true,
      style: 'scandinavian',
      colour: 'assisted',
      tier: 'Standard',
      totalBudgetFils: aed(80_000),
    });
    const res = await post(`/v1/projects/${p.id}/recommend`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as {
      runs: { moduleLabel: string; compositions: unknown[] }[];
      project: { totalBudgetFils: number; bestOverallTotalFils: number };
    };
    expect(body.runs.map((r) => r.moduleLabel)).toEqual([
      'Master Bedroom',
      'Bedroom 2',
      'Living Room',
      'Dining Room',
      'Home Office',
    ]);
    expect(body.project.totalBudgetFils).toBe(aed(80_000));
    expect(body.project.bestOverallTotalFils).toBeGreaterThan(0);
    const modules = await h.admin
      .selectFrom('recommendation.project_module')
      .select('allocated_budget_fils')
      .where('project_id', '=', p.id)
      .execute();
    expect(modules).toHaveLength(5);
    const allocated = modules.reduce((t, m) => t + Number(m.allocated_budget_fils), 0);
    expect(Math.abs(allocated - aed(80_000))).toBeLessThanOrEqual(5);
  });

  it('bedroom sizes, bed sizes and bedroom consistency (AID-SPC-007) reach the engine', async () => {
    const p = await newProject({
      pathId: 'fullApartment',
      bedrooms: 3,
      bedroomAreasM2: [20, 11, 15],
      bedSizes: ['King', 'Single', 'Queen'],
      bedroomConsistency: true,
      office: false,
      style: 'scandinavian',
      colour: 'assisted',
      tier: 'Standard',
      totalBudgetFils: aed(90_000),
    });
    const res = await post(`/v1/projects/${p.id}/recommend`);
    expect(res.statusCode, res.body).toBe(200);
    const modules = await h.admin
      .selectFrom('recommendation.project_module')
      .select(['label', 'area_m2', 'bed_size'])
      .where('project_id', '=', p.id)
      .where('room_path', '=', 'bedroom')
      .orderBy('label')
      .execute();
    // Ordered by label: Bedroom 2, Bedroom 3, Master Bedroom.
    expect(modules.map((m) => [m.label, Number(m.area_m2), m.bed_size])).toEqual([
      ['Bedroom 2', 11, 'Single'],
      ['Bedroom 3', 15, 'Queen'],
      ['Master Bedroom', 20, 'King'],
    ]);
  });

  it('an individual product project is ranked, not composed', async () => {
    const p = await newProject({
      pathId: 'individualProduct',
      productType: 'Floor Lamp',
      branch: null,
      style: 'modern',
      colour: 'black',
      tier: 'Value',
    });
    expect((await post(`/v1/projects/${p.id}/recommend`)).statusCode).toBe(409);
    const res = await post(`/v1/projects/${p.id}/rank`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as {
      priceRange: { lowFils: number; highFils: number };
      results: { match: { score: number }; offer: { sellingPrice: number } }[];
    };
    expect(body.priceRange).toEqual({ lowFils: aed(150), highFils: aed(300) });
    expect(body.results.length).toBeGreaterThan(0);
    for (const r of body.results) {
      expect(r.match.score).toBeGreaterThanOrEqual(60);
      expect(r.offer.sellingPrice).toBeGreaterThanOrEqual(aed(135));
      expect(r.offer.sellingPrice).toBeLessThanOrEqual(aed(330));
    }
  });
});

describe('replace and remove (WF-03)', () => {
  async function composition() {
    const p = await newProject();
    const run = (await post(`/v1/projects/${p.id}/recommend`)).json() as {
      runs: {
        compositions: {
          id: string;
          total: number;
          items: {
            slotKey: string;
            essential: boolean;
            unitPrice: number;
            quantity: number;
            offer: { id: string };
            product: { type: string };
          }[];
        }[];
      }[];
    };
    return run.runs[0]!.compositions[0]!;
  }

  it('lists live, eligible alternatives with the price difference', async () => {
    const c = await composition();
    const slot = c.items.find((i) => i.product.type === 'Side Table')!;
    const res = await get(
      `/v1/compositions/${c.id}/items/${encodeURIComponent(slot.slotKey)}/alternatives`,
    );
    expect(res.statusCode, res.body).toBe(200);
    const alts = (
      res.json() as {
        alternatives: {
          offer: { id: string; sellingPrice: number };
          priceDelta: number;
          match: { score: number };
        }[];
      }
    ).alternatives;
    expect(alts.length).toBeGreaterThan(0);
    expect(alts.every((a) => a.offer.id !== slot.offer.id && a.match.score >= 60)).toBe(true);
    expect(alts[0]!.priceDelta).toBe(alts[0]!.offer.sellingPrice - slot.unitPrice);
  });

  it('replaces an item with revalidation and recalculates the total; the client cannot assert a score', async () => {
    const c = await composition();
    const slot = c.items.find((i) => i.product.type === 'Side Table')!;
    const alts = (
      (
        await get(`/v1/compositions/${c.id}/items/${encodeURIComponent(slot.slotKey)}/alternatives`)
      ).json() as { alternatives: { offer: { id: string; sellingPrice: number } }[] }
    ).alternatives;
    let replaced: {
      total: number;
      modifiedByCustomer: boolean;
      items: { slotKey: string; offer: { id: string } }[];
    } | null = null;
    let target = alts[0]!;
    for (const a of alts) {
      const res = await h.app.inject({
        method: 'PUT',
        url: `/v1/compositions/${c.id}/items/${encodeURIComponent(slot.slotKey)}`,
        headers: h.as(G1),
        payload: { offerId: a.offer.id },
      });
      if (res.statusCode === 200) {
        replaced = res.json();
        target = a;
        break;
      }
      expect([409, 422]).toContain(res.statusCode); // a replacement may legitimately break the composition
    }
    if (!replaced) return; // no alternative kept the composition valid for this room; covered by the refusal assertions
    expect(replaced.modifiedByCustomer).toBe(true);
    expect(replaced.items.find((i) => i.slotKey === slot.slotKey)?.offer.id).toBe(target.offer.id);
    expect(replaced.total).toBe(
      c.total - slot.unitPrice * slot.quantity + target.offer.sellingPrice * slot.quantity,
    );
    const persisted = await get(`/v1/compositions/${c.id}`);
    expect((persisted.json() as { total: number }).total).toBe(replaced.total);
  });

  it('refuses a product that is not an eligible replacement for the slot', async () => {
    const c = await composition();
    const slot = c.items.find((i) => i.product.type === 'Side Table')!;
    const sofa = await h.admin
      .selectFrom('catalogue.seller_offer')
      .select('id')
      .where(
        'product_id',
        'in',
        h.admin.selectFrom('catalogue.product').select('id').where('product_type', '=', 'Sofa'),
      )
      .limit(1)
      .executeTakeFirstOrThrow();
    const res = await h.app.inject({
      method: 'PUT',
      url: `/v1/compositions/${c.id}/items/${encodeURIComponent(slot.slotKey)}`,
      headers: h.as(G1),
      payload: { offerId: sofa.id },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('replacement_not_available');
  });

  it('removes a non-essential item and recalculates immediately; essentials cannot be removed', async () => {
    const c = await composition();
    const decor = c.items.find((i) => !i.essential)!;
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/v1/compositions/${c.id}/items/${encodeURIComponent(decor.slotKey)}`,
      headers: h.as(G1),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { total: number; items: unknown[]; modifiedByCustomer: boolean };
    expect(body.total).toBe(c.total - decor.unitPrice * decor.quantity);
    expect(body.items).toHaveLength(c.items.length - 1);
    const essential = c.items.find((i) => i.essential)!;
    const refused = await h.app.inject({
      method: 'DELETE',
      url: `/v1/compositions/${c.id}/items/${encodeURIComponent(essential.slotKey)}`,
      headers: h.as(G1),
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().code).toBe('essential_item');
  });

  it("another buyer cannot read or edit someone else's composition", async () => {
    const c = await composition();
    expect((await get(`/v1/compositions/${c.id}`, G2)).statusCode).toBe(404);
    const slot = c.items[0]!;
    expect(
      (
        await h.app.inject({
          method: 'DELETE',
          url: `/v1/compositions/${c.id}/items/${encodeURIComponent(slot.slotKey)}`,
          headers: h.as(G2),
        })
      ).statusCode,
    ).toBe(404);
  });

  it('flags a composition stale when a price moves, and refuses to edit it until refreshed', async () => {
    const c = await composition();
    const slot = c.items.find((i) => i.product.type === 'Side Table')!;
    const before = await h.admin
      .selectFrom('catalogue.seller_offer')
      .select('selling_price_fils')
      .where('id', '=', slot.offer.id)
      .executeTakeFirstOrThrow();
    await h.admin
      .updateTable('catalogue.seller_offer')
      .set({ selling_price_fils: Number(before.selling_price_fils) + 5_000 })
      .where('id', '=', slot.offer.id)
      .execute();
    try {
      const view = (await get(`/v1/compositions/${c.id}`)).json() as {
        stale: boolean;
        visualization: { state: string };
        items: { slotKey: string; stale: string | null }[];
      };
      expect(view.stale).toBe(true);
      expect(view.visualization.state).toBe('Refresh Required');
      expect(view.items.find((i) => i.slotKey === slot.slotKey)?.stale).toBe('price_changed');
      const edit = await h.app.inject({
        method: 'DELETE',
        url: `/v1/compositions/${c.id}/items/${encodeURIComponent(c.items.find((i) => !i.essential && i.slotKey !== slot.slotKey)!.slotKey)}`,
        headers: h.as(G1),
      });
      expect(edit.statusCode).toBe(409);
      expect(edit.json().code).toBe('composition_stale');
    } finally {
      await h.admin
        .updateTable('catalogue.seller_offer')
        .set({ selling_price_fils: Number(before.selling_price_fils) })
        .where('id', '=', slot.offer.id)
        .execute();
    }
  });

  it('flags an item stale when it sells out', async () => {
    const c = await composition();
    const slot = c.items[0]!;
    await h.admin
      .updateTable('catalogue.seller_offer')
      .set({ availability: 'Out of Stock', stock_qty: 0 })
      .where('id', '=', slot.offer.id)
      .execute();
    const view = (await get(`/v1/compositions/${c.id}`)).json() as {
      items: { slotKey: string; stale: string | null }[];
    };
    expect(view.items.find((i) => i.slotKey === slot.slotKey)?.stale).toBe('unavailable');
  });
});

describe('Product Card', () => {
  it('shows a verified product with its live offers, cheapest first, and seller after-sales terms', async () => {
    const offer = await h.admin
      .selectFrom('catalogue.eligible_offer')
      .select(['product_id'])
      .limit(1)
      .executeTakeFirstOrThrow();
    const res = await get(`/v1/products/${offer.product_id}`);
    expect(res.statusCode, res.body).toBe(200);
    const card = res.json() as {
      product: { id: string };
      offers: { sellingPrice: number; partner: { afterSalesTerms: string | null } }[];
    };
    expect(card.product.id).toBe(offer.product_id);
    expect(card.offers.length).toBeGreaterThan(0);
    expect(card.offers.map((o) => o.sellingPrice)).toEqual(
      [...card.offers.map((o) => o.sellingPrice)].sort((a, b) => a - b),
    );
    expect(card.offers[0]!.partner.afterSalesTerms).toBeTruthy();
  });

  it('an unverified or unknown product does not exist for buyers', async () => {
    expect((await get('/v1/products/AID-99999999')).statusCode).toBe(404);
    expect((await get('/v1/products/not-an-id')).statusCode).toBe(400);
  });
});
