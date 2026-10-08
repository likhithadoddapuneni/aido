import type { ProjectInput } from '@aidooi/contracts';
import {
  apartmentBudget,
  compositionFor,
  fils,
  geometryOf,
  modulesOf,
  projectTargetRange,
  roomBudget,
  sizeClass,
  studioBudget,
  studioSizeClass,
  type Fils,
  type MultiRoomProject,
  type RoomProject,
  type SizeClass,
} from '@aidooi/domain';

type Of<P extends ProjectInput['pathId']> = Extract<ProjectInput, { pathId: P }>;
export type RoomInput = Of<'livingRoom'> | Of<'bedroom'> | Of<'diningRoom'> | Of<'homeOffice'>;
export type MultiRoomInput = Of<'studio'> | Of<'fullApartment'> | Of<'villa'>;

export const isRoomInput = (i: ProjectInput): i is RoomInput =>
  i.pathId === 'livingRoom' ||
  i.pathId === 'bedroom' ||
  i.pathId === 'diningRoom' ||
  i.pathId === 'homeOffice';
export const isMultiRoomInput = (i: ProjectInput): i is MultiRoomInput =>
  i.pathId === 'studio' || i.pathId === 'fullApartment' || i.pathId === 'villa';

export function toRoomProject(i: RoomInput): RoomProject {
  const base = { path: i.pathId, tier: i.tier, style: i.style, colour: i.colour } as const;
  const dims = { lengthM: i.lengthM, widthM: i.widthM };
  switch (i.pathId) {
    case 'livingRoom':
      return { ...base, spec: dims };
    case 'bedroom':
      return { ...base, spec: { ...dims, bedSize: i.bedSize } };
    case 'diningRoom':
      return { ...base, spec: { ...dims, capacity: i.capacity } };
    case 'homeOffice':
      return { ...base, spec: { ...dims, users: i.users } };
  }
}

export function toMultiRoomProject(i: MultiRoomInput): MultiRoomProject {
  const common = {
    tier: i.tier,
    style: i.style,
    colour: i.colour,
    totalBudget: fils(i.totalBudgetFils),
  } as const;
  switch (i.pathId) {
    case 'studio':
      return {
        ...common,
        kind: 'studio',
        spec: { totalAreaM2: i.totalAreaM2, sleepingSetup: i.sleepingSetup },
      };
    case 'fullApartment':
      return {
        ...common,
        kind: 'apartment',
        bedroomConsistency: i.bedroomConsistency,
        spec: roomsSpec(i),
      };
    case 'villa':
      return {
        ...common,
        kind: 'villa',
        bedroomConsistency: i.bedroomConsistency,
        spec: { ...roomsSpec(i), floors: i.floors },
      };
  }
}

const roomsSpec = (i: Of<'fullApartment'> | Of<'villa'>) => ({
  bedrooms: i.bedrooms,
  office: i.office,
  ...(i.bedroomAreasM2 ? { bedroomAreasM2: i.bedroomAreasM2 } : {}),
  ...(i.bedSizes ? { bedSizes: i.bedSizes } : {}),
  ...(i.livingAreaM2 !== undefined ? { livingAreaM2: i.livingAreaM2 } : {}),
  ...(i.diningCapacity !== undefined ? { diningCapacity: i.diningCapacity } : {}),
  ...(i.masterBedSize !== undefined ? { masterBedSize: i.masterBedSize } : {}),
});

export interface ProjectSummary {
  readonly sizeClass: SizeClass | null;
  readonly range: readonly [Fils, Fils] | null;
}

/** Everything derivable from the customer's answers without touching the catalogue. */
export function summarise(i: ProjectInput): ProjectSummary {
  if (isRoomInput(i)) {
    const g = geometryOf(toRoomProject(i));
    return g
      ? { sizeClass: g.sizeClass, range: roomBudget(i.pathId, g.sizeClass, i.tier) }
      : { sizeClass: null, range: null };
  }
  if (i.pathId === 'studio') {
    return {
      sizeClass: studioSizeClass(i.totalAreaM2),
      range: studioBudget(toMultiRoomSpec(i), i.tier),
    };
  }
  if (i.pathId === 'fullApartment')
    return { sizeClass: null, range: apartmentBudget(roomsSpec(i), i.tier) };
  if (i.pathId === 'villa')
    return { sizeClass: null, range: projectTargetRange(toMultiRoomProject(i)) };
  return { sizeClass: null, range: null };
}

const toMultiRoomSpec = (i: Of<'studio'>) => ({
  totalAreaM2: i.totalAreaM2,
  sleepingSetup: i.sleepingSetup,
});

/** Product types the engine may need for this project: the catalogue slice to load. */
export function typesNeeded(i: ProjectInput): string[] {
  const types = new Set<string>();
  if (i.pathId === 'individualProduct') return [i.productType];
  if (isRoomInput(i)) {
    const p = toRoomProject(i);
    const g = geometryOf(p);
    if (g) for (const s of compositionFor(p.path, g.sizeClass, p.spec)) types.add(s.type);
    return [...types];
  }
  for (const m of modulesOf(toMultiRoomProject(i))) {
    const cls = sizeClass(m.path, m.areaM2);
    const spec = {
      ...(m.bedSize ? { bedSize: m.bedSize } : {}),
      ...(m.capacity ? { capacity: m.capacity } : {}),
      ...(m.users ? { users: m.users } : {}),
    };
    for (const s of compositionFor(m.path, cls, spec)) types.add(s.type);
  }
  return [...types];
}
