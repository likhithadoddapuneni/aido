import type { Composition, Project } from '@aidooi/contracts';
import type { Recommendation } from '../src/api/services.ts';

export const project = (over: Partial<Project> = {}): Project => ({
  id: '11111111-1111-4111-8111-111111111111',
  input: {
    pathId: 'livingRoom',
    lengthM: 5,
    widthM: 4,
    style: 'modern',
    colour: 'grey',
    tier: 'Standard',
  },
  sizeClass: 'Medium',
  budgetRange: { lowFils: 850_000, highFils: 1_400_000 },
  state: 'Ready for Recommendation',
  createdAt: '2026-10-07T10:00:00.000Z',
  updatedAt: '2026-10-07T10:00:00.000Z',
  ...over,
});

const productBase = {
  secondaryColour: null,
  secondaryStyle: null,
  material: 'Fabric',
  attributes: {},
  imageUrls: [] as string[],
  heightCm: 82,
} as const;

export const offer = (id: string, price = 450_000) => ({
  id,
  sellingPrice: price,
  originalPrice: null,
  availability: 'In Stock' as const,
  viewingStatus: 'On Display' as const,
  deliveryDays: 3,
  partner: {
    id: '22222222-2222-4222-8222-222222222222',
    tradeName: 'Marina Living',
    afterSalesTerms: 'Returns within 7 days if unused.',
  },
  location: {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Marina Showroom',
    area: 'Dubai Marina',
    emirate: 'Dubai',
  },
});

export const composition = (over: Partial<Composition> = {}): Composition => ({
  id: '44444444-4444-4444-8444-444444444444',
  runId: '55555555-5555-4555-8555-555555555555',
  objective: 'best_overall',
  label: 'Best Overall Match',
  blurb: 'x',
  state: 'Valid',
  score: 88,
  classification: 'Strong Composition',
  total: 900_000,
  ceiling: 1_400_000,
  modifiedByCustomer: false,
  breakdown: null,
  items: [
    {
      slotKey: 'Sofa#0',
      role: 'anchor',
      essential: true,
      quantity: 1,
      unitPrice: 450_000,
      lineTotal: 450_000,
      match: {
        score: 92,
        classification: 'Excellent Match',
        fit: 100,
        style: 100,
        colour: 85,
        budget: 100,
      },
      product: {
        id: 'AID-00000001',
        name: 'Orla Sofa 3-Seater',
        type: 'Sofa',
        widthCm: 215,
        depthCm: 92,
        primaryColour: 'grey',
        primaryStyle: 'modern',
        ...productBase,
      },
      offer: offer('AIO-00000001'),
      stale: null,
    },
    {
      slotKey: 'Vase#1',
      role: 'secondary',
      essential: false,
      quantity: 1,
      unitPrice: 12_000,
      lineTotal: 12_000,
      match: {
        score: 80,
        classification: 'Strong Match',
        fit: 85,
        style: 70,
        colour: 100,
        budget: 90,
      },
      product: {
        id: 'AID-00000002',
        name: 'Form Vase',
        type: 'Vase',
        widthCm: 20,
        depthCm: 20,
        primaryColour: 'white',
        primaryStyle: 'modern',
        ...productBase,
        material: 'Ceramic',
      },
      offer: offer('AIO-00000002', 12_000),
      stale: null,
    },
  ],
  unfilled: [],
  stale: false,
  room: { widthCm: 500, depthCm: 400 },
  visualization: { fidelity: 'Concept', state: 'Current', hotspots: {} },
  ...over,
});

export const run = (
  over: Partial<Recommendation['runs'][number]> = {},
): Recommendation['runs'][number] => ({
  id: '66666666-6666-4666-8666-666666666666',
  projectId: project().id,
  moduleId: null,
  moduleLabel: null,
  status: 'Completed',
  reason: null,
  sizeClass: 'Medium',
  range: { lowFils: 850_000, highFils: 1_400_000 },
  compositions: [
    composition(),
    composition({
      id: '44444444-4444-4444-8444-444444444445',
      objective: 'best_value',
      score: 84,
      total: 700_000,
    }),
    composition({
      id: '44444444-4444-4444-8444-444444444446',
      objective: 'best_style',
      score: 81,
      total: 950_000,
    }),
    composition({
      id: '44444444-4444-4444-8444-444444444447',
      objective: 'premium',
      score: 90,
      total: 1_300_000,
    }),
  ],
  createdAt: '2026-10-07T10:00:00.000Z',
  ...over,
});

export const recommendation = (
  runs = [run()],
  summary: Recommendation['project'] = null,
): Recommendation => ({ runs, project: summary });
