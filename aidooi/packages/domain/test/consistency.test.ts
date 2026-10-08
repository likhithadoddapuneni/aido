import { describe, expect, it } from 'vitest';
import {
  CONSISTENCY_PICK_BONUS,
  TIERS,
  aed,
  apartmentModules,
  buildSlots,
  geometryOf,
  roomBudget,
  runProject,
  runRecommendation,
  slotCandidates,
  villaModules,
  type MultiRoomProject,
  type RoomProject,
} from '../src/index.ts';
import { seedCatalogue } from '../src/testing/index.ts';

const { catalogue } = seedCatalogue();

describe('bedroom sizes and bed sizes are inputs (AID-SPC-007)', () => {
  it('each bedroom takes its own area and bed size; unspecified ones use the defaults', () => {
    const mods = apartmentModules({
      bedrooms: 3,
      bedroomAreasM2: [20, 11],
      bedSizes: ['Super King', 'Single'],
    });
    const bedrooms = mods.filter((m) => m.path === 'bedroom');
    expect(bedrooms.map((m) => m.areaM2)).toEqual([20, 11, 13]);
    expect(bedrooms.map((m) => m.bedSize)).toEqual(['Super King', 'Single', 'Queen']);
    expect(
      apartmentModules({ bedrooms: 2 })
        .filter((m) => m.path === 'bedroom')
        .map((m) => m.areaM2),
    ).toEqual([18, 13]);
  });

  it('the master bed size input still wins for the master', () => {
    const [master] = villaModules({
      bedrooms: 2,
      masterBedSize: 'King',
      bedSizes: ['Queen'],
    }).filter((m) => m.path === 'bedroom');
    expect(master?.bedSize).toBe('King');
  });
});

describe('bedroom consistency (gap #12): a recommendation modifier, never a quality or budget one', () => {
  const bedroom = (extra: Partial<RoomProject> = {}): RoomProject => ({
    path: 'bedroom',
    tier: 'Value',
    style: 'scandinavian',
    colour: 'assisted',
    spec: { lengthM: 4.2, widthM: 3.6, bedSize: 'Queen' },
    ...extra,
  });

  /** A Bed from another family that the engine rates within `gap` points of its own choice. */
  function runnerUp(project: RoomProject, gap: (best: number, other: number) => boolean) {
    const base = runRecommendation(project, catalogue);
    const chosen = base.options[0]?.items.find((i) => i.product.type === 'Bed');
    if (!chosen) return null;
    const geometry = geometryOf(project)!;
    const slots = buildSlots(
      project.path,
      geometry.sizeClass,
      project.spec,
      base.ceiling,
      project.tier,
    );
    const slot = slots.find((s) => s.type === 'Bed')!;
    const ctx = {
      style: project.style,
      colour: project.colour,
      spec: project.spec,
      room: geometry,
    };
    const other = slotCandidates(slot, ctx, catalogue).find(
      (c) =>
        c.eligible && c.product.parentId !== chosen.product.parentId && gap(chosen.total, c.total),
    );
    return other ? { chosen, other } : null;
  }

  it('a close alternative from the preferred family wins the selection', () => {
    let close = null as ReturnType<typeof runnerUp>;
    let project = bedroom();
    for (const tier of TIERS) {
      for (const style of ['scandinavian', 'modern', 'japandi', 'classic'] as const) {
        project = bedroom({ tier, style });
        close = runnerUp(
          project,
          (best, other) => best - other >= 0 && best - other < CONSISTENCY_PICK_BONUS,
        );
        if (close) break;
      }
      if (close) break;
    }
    expect(close, 'the seed catalogue must offer a close alternative somewhere').not.toBeNull();
    const withPref = runRecommendation(
      { ...project, preferParents: new Map([['Bed', close!.other.product.parentId]]) },
      catalogue,
    );
    const bed = withPref.options[0]?.items.find((i) => i.product.type === 'Bed');
    expect(bed?.product.parentId).toBe(close!.other.product.parentId);
    // The Match Score of what was chosen is its own honest score — the bonus never touches it.
    expect(bed?.total).toBe(close!.other.total);
    expect(bed?.eligible).toBe(true);
  });

  it('a preference for a family that does not exist changes nothing', () => {
    const base = runRecommendation(bedroom(), catalogue);
    const pref = runRecommendation(
      bedroom({
        preferParents: new Map([
          ['Bed', 'AIP-99999999'],
          ['Wardrobe', 'AIP-99999998'],
        ]),
      }),
      catalogue,
    );
    expect(JSON.stringify(pref)).toBe(JSON.stringify(base));
  });

  const apartment = (consistent: boolean): MultiRoomProject => ({
    kind: 'apartment',
    spec: {
      bedrooms: 4,
      bedroomAreasM2: [18, 11, 15, 13],
      bedSizes: ['King', 'Single', 'Queen', 'Queen'],
      office: false,
    },
    tier: 'Standard',
    style: 'scandinavian',
    colour: 'assisted',
    totalBudget: aed(110_000),
    bedroomConsistency: consistent,
  });

  it('in a project it leans later bedrooms toward the first guest bedroom, without lowering any standard', () => {
    const off = runProject(apartment(false), catalogue);
    const on = runProject(apartment(true), catalogue);
    const guest = (r: typeof on) =>
      r.modules.filter((m) => m.path === 'bedroom' && m.label !== 'Master Bedroom');
    const sameFamilies = (r: typeof on) => {
      const [ref, ...rest] = guest(r);
      const refParents = new Map(
        ref!.run.options[0]!.items.map((i) => [i.product.type, i.product.parentId]),
      );
      return rest.reduce(
        (n, m) =>
          n +
          (m.run.options[0]?.items.filter(
            (i) => refParents.get(i.product.type) === i.product.parentId,
          ).length ?? 0),
        0,
      );
    };
    expect(sameFamilies(on)).toBeGreaterThanOrEqual(sameFamilies(off));

    // The master and the reference bedroom are untouched by the modifier.
    const [masterOff, masterOn] = [off.modules[0]!, on.modules[0]!];
    expect(JSON.stringify(masterOn.run.options)).toBe(JSON.stringify(masterOff.run.options));
    expect(JSON.stringify(guest(on)[0]!.run.options)).toBe(
      JSON.stringify(guest(off)[0]!.run.options),
    );

    // Quality and budget rules hold in every module, with the modifier on.
    for (const m of on.modules) {
      for (const o of m.run.options) {
        expect(o.valid).toBe(true);
        if (!o.valid) continue;
        expect(o.score).toBeGreaterThanOrEqual(70);
        expect(o.total).toBeLessThanOrEqual(o.ceiling);
        for (const i of o.items) expect(i.eligible).toBe(true);
      }
    }
    expect(roomBudget('bedroom', 'Medium', 'Standard')[1]).toBeGreaterThan(0);
  });

  it('is off unless asked for', () => {
    const none = runProject({ ...apartment(false) }, catalogue);
    const omitted = runProject(
      { ...apartment(false), bedroomConsistency: undefined as never },
      catalogue,
    );
    expect(JSON.stringify(omitted)).toBe(JSON.stringify(none));
  });
});
