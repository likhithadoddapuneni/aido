/**
 * AID-LOG-002…005 (room composition, fit and budget), AID-LOG-006 (studio) and AID-LOG-007
 * (apartment) tables, ported from the reviewed MVP prototype.
 *
 * Preferred widths (`w`, cm) are guidance, not cut-off filters (AID-LOG-002 §2). Default
 * compositions are likewise defaults, not hard constraints.
 */
import { aed, type Fils } from '../kernel/money.ts';
import { TIERS, type Tier } from './vocab.ts';

export const SIZE_CLASSES = ['Compact', 'Small', 'Medium', 'Large', 'Extra Large'] as const;
export type SizeClass = (typeof SIZE_CLASSES)[number];

export const ROOM_PATHS = ['livingRoom', 'bedroom', 'diningRoom', 'homeOffice'] as const;
export type RoomPath = (typeof ROOM_PATHS)[number];

export type SlotRole = 'anchor' | 'core' | 'secondary';

export interface SlotTemplate {
  readonly type: string;
  readonly qty?: number;
  readonly qtyFrom?: 'capacity' | 'users';
  readonly branch?: string;
  readonly branchFrom?: 'bedSize' | 'capacity';
  /** Preferred width band in cm. `null` = derived from the practical attribute (bed size). */
  readonly w: readonly [number, number] | null;
  readonly role: SlotRole;
  readonly essential?: true;
}

type Bands = readonly (readonly [upperBoundM2: number, SizeClass])[];
type BudgetRows = readonly (readonly [number, number])[];

interface RoomLogic {
  readonly bands: Bands;
  readonly composition: Readonly<Record<SizeClass, readonly SlotTemplate[]>>;
  readonly budget: Readonly<Record<SizeClass, BudgetRows>>;
}

/* ---------------- Tables (ported from the reviewed MVP) ---------------- */

const LIVING_ROOM: RoomLogic = {
  bands: [
    [12, 'Compact'],
    [20, 'Small'],
    [30, 'Medium'],
    [45, 'Large'],
    [Infinity, 'Extra Large'],
  ],
  composition: {
    Compact: [
      { type: 'Sofa', qty: 1, branch: '2', w: [140, 180], role: 'anchor', essential: true },
      { type: 'Coffee Table', qty: 1, w: [60, 90], role: 'core', essential: true },
      { type: 'Side Table', qty: 1, w: [30, 45], role: 'core' },
      { type: 'TV Unit', qty: 1, w: [100, 140], role: 'core' },
      { type: 'Rug', qty: 1, branch: 'Small', w: [120, 180], role: 'secondary' },
      { type: 'Floor Lamp', qty: 1, w: [25, 45], role: 'secondary' },
      { type: 'Wall Art', qty: 1, w: [40, 90], role: 'secondary' },
      { type: 'Vase', qty: 1, w: [10, 30], role: 'secondary' },
    ],
    Small: [
      { type: 'Sofa', qty: 1, branch: '3', w: [170, 220], role: 'anchor', essential: true },
      { type: 'Accent Chair', qty: 1, w: [60, 80], role: 'core' },
      { type: 'Coffee Table', qty: 1, w: [70, 110], role: 'core', essential: true },
      { type: 'Side Table', qty: 1, w: [35, 50], role: 'core' },
      { type: 'TV Unit', qty: 1, w: [120, 180], role: 'core' },
      { type: 'Rug', qty: 1, branch: 'Medium', w: [160, 230], role: 'secondary' },
      { type: 'Floor Lamp', qty: 1, w: [25, 45], role: 'secondary' },
      { type: 'Wall Art', qty: 1, w: [60, 120], role: 'secondary' },
      { type: 'Vase', qty: 1, w: [10, 30], role: 'secondary' },
      { type: 'Planter', qty: 1, w: [20, 45], role: 'secondary' },
    ],
    Medium: [
      { type: 'Sofa', qty: 1, branch: '3', w: [200, 250], role: 'anchor', essential: true },
      { type: 'Accent Chair', qty: 1, w: [70, 90], role: 'core' },
      { type: 'Coffee Table', qty: 1, w: [90, 130], role: 'core', essential: true },
      { type: 'Side Table', qty: 2, w: [40, 55], role: 'core' },
      { type: 'TV Unit', qty: 1, w: [160, 220], role: 'core' },
      { type: 'Rug', qty: 1, branch: 'Large', w: [200, 300], role: 'secondary' },
      { type: 'Floor Lamp', qty: 1, w: [25, 45], role: 'secondary' },
      { type: 'Table Lamp', qty: 1, w: [15, 35], role: 'secondary' },
      { type: 'Wall Art', qty: 2, w: [60, 140], role: 'secondary' },
      { type: 'Vase', qty: 1, w: [10, 35], role: 'secondary' },
      { type: 'Planter', qty: 1, w: [20, 50], role: 'secondary' },
    ],
    Large: [
      { type: 'Sofa', qty: 1, branch: '4', w: [240, 300], role: 'anchor', essential: true },
      { type: 'Accent Chair', qty: 2, w: [70, 95], role: 'core' },
      { type: 'Coffee Table', qty: 1, w: [110, 150], role: 'core', essential: true },
      { type: 'Side Table', qty: 2, w: [40, 60], role: 'core' },
      { type: 'TV Unit', qty: 1, w: [180, 260], role: 'core' },
      { type: 'Rug', qty: 1, branch: 'Large', w: [200, 300], role: 'secondary' },
      { type: 'Floor Lamp', qty: 2, w: [25, 50], role: 'secondary' },
      { type: 'Table Lamp', qty: 1, w: [15, 35], role: 'secondary' },
      { type: 'Wall Art', qty: 2, w: [70, 160], role: 'secondary' },
      { type: 'Mirror', qty: 1, w: [50, 110], role: 'secondary' },
      { type: 'Vase', qty: 1, w: [10, 35], role: 'secondary' },
      { type: 'Planter', qty: 1, w: [25, 55], role: 'secondary' },
    ],
    'Extra Large': [
      { type: 'Sofa', qty: 1, branch: '5', w: [280, 360], role: 'anchor', essential: true },
      { type: 'Accent Chair', qty: 3, w: [75, 100], role: 'core' },
      { type: 'Coffee Table', qty: 2, w: [120, 160], role: 'core', essential: true },
      { type: 'Side Table', qty: 3, w: [40, 65], role: 'core' },
      { type: 'TV Unit', qty: 1, w: [220, 300], role: 'core' },
      { type: 'Rug', qty: 1, branch: 'Extra Large', w: [250, 350], role: 'secondary' },
      { type: 'Floor Lamp', qty: 3, w: [25, 50], role: 'secondary' },
      { type: 'Table Lamp', qty: 2, w: [15, 35], role: 'secondary' },
      { type: 'Wall Art', qty: 3, w: [70, 180], role: 'secondary' },
      { type: 'Mirror', qty: 1, w: [60, 120], role: 'secondary' },
      { type: 'Vase', qty: 2, w: [10, 40], role: 'secondary' },
      { type: 'Planter', qty: 2, w: [25, 60], role: 'secondary' },
    ],
  },
  budget: {
    Compact: [
      [800, 2000],
      [2000, 3500],
      [3500, 6000],
      [6000, 10000],
      [10000, 20000],
    ],
    Small: [
      [1500, 3500],
      [3500, 6000],
      [6000, 10000],
      [10000, 17000],
      [17000, 34000],
    ],
    Medium: [
      [2500, 5000],
      [5000, 8500],
      [8500, 14000],
      [14000, 23000],
      [23000, 46000],
    ],
    Large: [
      [4000, 7500],
      [7500, 12000],
      [12000, 20000],
      [20000, 33000],
      [33000, 66000],
    ],
    'Extra Large': [
      [6000, 10000],
      [10000, 16000],
      [16000, 27000],
      [27000, 45000],
      [45000, 90000],
    ],
  },
};

const BEDROOM: RoomLogic = {
  bands: [
    [9, 'Compact'],
    [14, 'Small'],
    [20, 'Medium'],
    [30, 'Large'],
    [Infinity, 'Extra Large'],
  ],
  composition: {
    Compact: [
      { type: 'Bed', qty: 1, branchFrom: 'bedSize', w: null, role: 'anchor', essential: true },
      { type: 'Bedside Table', qty: 1, w: [30, 40], role: 'core', essential: true },
      { type: 'Wardrobe', qty: 1, branch: 'Small', w: [80, 120], role: 'core', essential: true },
      { type: 'Rug', qty: 1, branch: 'Small', w: [120, 180], role: 'secondary' },
      { type: 'Table Lamp', qty: 1, w: [15, 30], role: 'secondary' },
      { type: 'Mirror', qty: 1, w: [40, 70], role: 'secondary' },
      { type: 'Wall Art', qty: 1, w: [40, 90], role: 'secondary' },
    ],
    Small: [
      { type: 'Bed', qty: 1, branchFrom: 'bedSize', w: null, role: 'anchor', essential: true },
      { type: 'Bedside Table', qty: 2, w: [35, 50], role: 'core', essential: true },
      { type: 'Wardrobe', qty: 1, branch: 'Medium', w: [100, 160], role: 'core', essential: true },
      { type: 'Chest of Drawers', qty: 1, w: [60, 100], role: 'core' },
      { type: 'Rug', qty: 1, branch: 'Medium', w: [160, 230], role: 'secondary' },
      { type: 'Table Lamp', qty: 2, w: [15, 32], role: 'secondary' },
      { type: 'Mirror', qty: 1, w: [40, 80], role: 'secondary' },
      { type: 'Wall Art', qty: 2, w: [50, 110], role: 'secondary' },
    ],
    Medium: [
      { type: 'Bed', qty: 1, branchFrom: 'bedSize', w: null, role: 'anchor', essential: true },
      { type: 'Bedside Table', qty: 2, w: [40, 55], role: 'core', essential: true },
      { type: 'Wardrobe', qty: 1, branch: 'Medium', w: [140, 220], role: 'core', essential: true },
      { type: 'Chest of Drawers', qty: 1, w: [80, 120], role: 'core' },
      { type: 'Accent Chair', qty: 1, w: [60, 80], role: 'core' },
      { type: 'Rug', qty: 1, branch: 'Large', w: [200, 300], role: 'secondary' },
      { type: 'Table Lamp', qty: 2, w: [15, 35], role: 'secondary' },
      { type: 'Mirror', qty: 1, w: [50, 100], role: 'secondary' },
      { type: 'Wall Art', qty: 2, w: [60, 130], role: 'secondary' },
      { type: 'Vase', qty: 1, w: [10, 30], role: 'secondary' },
    ],
    Large: [
      { type: 'Bed', qty: 1, branchFrom: 'bedSize', w: null, role: 'anchor', essential: true },
      { type: 'Bedside Table', qty: 2, w: [45, 60], role: 'core', essential: true },
      { type: 'Wardrobe', qty: 1, branch: 'Large', w: [180, 280], role: 'core', essential: true },
      { type: 'Chest of Drawers', qty: 1, w: [100, 140], role: 'core' },
      { type: 'Accent Chair', qty: 1, w: [70, 90], role: 'core' },
      { type: 'Side Table', qty: 1, w: [35, 50], role: 'core' },
      { type: 'Rug', qty: 1, branch: 'Large', w: [200, 300], role: 'secondary' },
      { type: 'Table Lamp', qty: 2, w: [15, 35], role: 'secondary' },
      { type: 'Floor Lamp', qty: 1, w: [25, 45], role: 'secondary' },
      { type: 'Mirror', qty: 1, w: [60, 120], role: 'secondary' },
      { type: 'Wall Art', qty: 2, w: [60, 150], role: 'secondary' },
      { type: 'Planter', qty: 1, w: [20, 50], role: 'secondary' },
    ],
    'Extra Large': [
      { type: 'Bed', qty: 1, branchFrom: 'bedSize', w: null, role: 'anchor', essential: true },
      { type: 'Bedside Table', qty: 2, w: [50, 70], role: 'core', essential: true },
      { type: 'Wardrobe', qty: 1, branch: 'Large', w: [240, 350], role: 'core', essential: true },
      { type: 'Chest of Drawers', qty: 1, w: [110, 160], role: 'core' },
      { type: 'Accent Chair', qty: 2, w: [70, 95], role: 'core' },
      { type: 'Side Table', qty: 1, w: [40, 60], role: 'core' },
      { type: 'Rug', qty: 1, branch: 'Extra Large', w: [250, 350], role: 'secondary' },
      { type: 'Table Lamp', qty: 2, w: [15, 35], role: 'secondary' },
      { type: 'Floor Lamp', qty: 1, w: [25, 50], role: 'secondary' },
      { type: 'Mirror', qty: 1, w: [70, 140], role: 'secondary' },
      { type: 'Wall Art', qty: 3, w: [60, 160], role: 'secondary' },
      { type: 'Vase', qty: 1, w: [10, 35], role: 'secondary' },
      { type: 'Planter', qty: 1, w: [25, 55], role: 'secondary' },
    ],
  },
  budget: {
    Compact: [
      [1000, 2000],
      [2000, 3500],
      [3500, 6000],
      [6000, 10000],
      [10000, 20000],
    ],
    Small: [
      [1500, 3000],
      [3000, 5000],
      [5000, 8000],
      [8000, 14000],
      [14000, 28000],
    ],
    Medium: [
      [2500, 4500],
      [4500, 7000],
      [7000, 11000],
      [11000, 18000],
      [18000, 36000],
    ],
    Large: [
      [3500, 6000],
      [6000, 9500],
      [9500, 15000],
      [15000, 25000],
      [25000, 50000],
    ],
    'Extra Large': [
      [5000, 8000],
      [8000, 13000],
      [13000, 20000],
      [20000, 33000],
      [33000, 66000],
    ],
  },
};

const DINING_ROOM: RoomLogic = {
  bands: [
    [8, 'Compact'],
    [12, 'Small'],
    [18, 'Medium'],
    [25, 'Large'],
    [Infinity, 'Extra Large'],
  ],
  composition: {
    Compact: [
      {
        type: 'Dining Table',
        qty: 1,
        branchFrom: 'capacity',
        w: [80, 140],
        role: 'anchor',
        essential: true,
      },
      { type: 'Dining Chair', qtyFrom: 'capacity', w: [40, 52], role: 'core', essential: true },
      { type: 'Pendant Light', qty: 1, w: [25, 45], role: 'core' },
      { type: 'Wall Art', qty: 1, w: [40, 90], role: 'secondary' },
      { type: 'Vase', qty: 1, w: [10, 28], role: 'secondary' },
    ],
    Small: [
      {
        type: 'Dining Table',
        qty: 1,
        branchFrom: 'capacity',
        w: [120, 180],
        role: 'anchor',
        essential: true,
      },
      { type: 'Dining Chair', qtyFrom: 'capacity', w: [42, 55], role: 'core', essential: true },
      { type: 'Pendant Light', qty: 1, w: [30, 55], role: 'core' },
      { type: 'Rug', qty: 1, branch: 'Medium', w: [160, 230], role: 'secondary' },
      { type: 'Sideboard', qty: 1, w: [80, 120], role: 'core' },
      { type: 'Wall Art', qty: 1, w: [50, 110], role: 'secondary' },
      { type: 'Vase', qty: 1, w: [10, 30], role: 'secondary' },
    ],
    Medium: [
      {
        type: 'Dining Table',
        qty: 1,
        branchFrom: 'capacity',
        w: [140, 200],
        role: 'anchor',
        essential: true,
      },
      { type: 'Dining Chair', qtyFrom: 'capacity', w: [42, 58], role: 'core', essential: true },
      { type: 'Pendant Light', qty: 1, w: [35, 70], role: 'core' },
      { type: 'Rug', qty: 1, branch: 'Large', w: [200, 300], role: 'secondary' },
      { type: 'Sideboard', qty: 1, w: [120, 180], role: 'core' },
      { type: 'Mirror', qty: 1, w: [50, 110], role: 'secondary' },
      { type: 'Wall Art', qty: 1, w: [60, 130], role: 'secondary' },
      { type: 'Vase', qty: 2, w: [10, 32], role: 'secondary' },
    ],
    Large: [
      {
        type: 'Dining Table',
        qty: 1,
        branchFrom: 'capacity',
        w: [160, 240],
        role: 'anchor',
        essential: true,
      },
      { type: 'Dining Chair', qtyFrom: 'capacity', w: [44, 60], role: 'core', essential: true },
      { type: 'Chandelier', qty: 1, w: [45, 90], role: 'core' },
      { type: 'Rug', qty: 1, branch: 'Large', w: [200, 300], role: 'secondary' },
      { type: 'Sideboard', qty: 1, w: [160, 220], role: 'core' },
      { type: 'Console Table', qty: 1, w: [100, 160], role: 'core' },
      { type: 'Mirror', qty: 1, w: [60, 130], role: 'secondary' },
      { type: 'Wall Art', qty: 2, w: [60, 150], role: 'secondary' },
      { type: 'Vase', qty: 2, w: [10, 35], role: 'secondary' },
      { type: 'Planter', qty: 1, w: [25, 55], role: 'secondary' },
    ],
    'Extra Large': [
      {
        type: 'Dining Table',
        qty: 1,
        branchFrom: 'capacity',
        w: [200, 300],
        role: 'anchor',
        essential: true,
      },
      { type: 'Dining Chair', qtyFrom: 'capacity', w: [44, 62], role: 'core', essential: true },
      { type: 'Chandelier', qty: 2, w: [50, 100], role: 'core' },
      { type: 'Rug', qty: 1, branch: 'Extra Large', w: [250, 350], role: 'secondary' },
      { type: 'Sideboard', qty: 1, w: [180, 260], role: 'core' },
      { type: 'Console Table', qty: 1, w: [120, 180], role: 'core' },
      { type: 'Mirror', qty: 1, w: [70, 150], role: 'secondary' },
      { type: 'Wall Art', qty: 3, w: [60, 170], role: 'secondary' },
      { type: 'Vase', qty: 2, w: [10, 40], role: 'secondary' },
      { type: 'Planter', qty: 2, w: [25, 60], role: 'secondary' },
    ],
  },
  budget: {
    Compact: [
      [500, 1200],
      [1200, 2000],
      [2000, 3500],
      [3500, 6000],
      [6000, 12000],
    ],
    Small: [
      [1000, 2000],
      [2000, 3500],
      [3500, 5500],
      [5500, 9000],
      [9000, 18000],
    ],
    Medium: [
      [1500, 3000],
      [3000, 5000],
      [5000, 8000],
      [8000, 13000],
      [13000, 26000],
    ],
    Large: [
      [2500, 4500],
      [4500, 7000],
      [7000, 11000],
      [11000, 18000],
      [18000, 36000],
    ],
    'Extra Large': [
      [3500, 6000],
      [6000, 9500],
      [9500, 15000],
      [15000, 25000],
      [25000, 50000],
    ],
  },
};

const HOME_OFFICE: RoomLogic = {
  bands: [
    [6, 'Compact'],
    [10, 'Small'],
    [15, 'Medium'],
    [22, 'Large'],
    [Infinity, 'Extra Large'],
  ],
  composition: {
    Compact: [
      { type: 'Desk', qty: 1, w: [80, 120], role: 'anchor', essential: true },
      { type: 'Office Chair', qtyFrom: 'users', w: [55, 70], role: 'core', essential: true },
      { type: 'Task Lamp', qty: 1, w: [12, 28], role: 'core' },
      { type: 'Bookcase', qty: 1, w: [50, 80], role: 'core' },
      { type: 'Wall Art', qty: 1, w: [40, 90], role: 'secondary' },
    ],
    Small: [
      { type: 'Desk', qtyFrom: 'users', w: [100, 140], role: 'anchor', essential: true },
      { type: 'Office Chair', qtyFrom: 'users', w: [55, 72], role: 'core', essential: true },
      { type: 'Task Lamp', qtyFrom: 'users', w: [12, 30], role: 'core' },
      { type: 'Bookcase', qty: 1, w: [60, 100], role: 'core' },
      { type: 'Storage Cabinet', qty: 1, w: [60, 110], role: 'core' },
      { type: 'Wall Art', qty: 1, w: [50, 110], role: 'secondary' },
      { type: 'Planter', qty: 1, w: [20, 45], role: 'secondary' },
    ],
    Medium: [
      { type: 'Desk', qtyFrom: 'users', w: [120, 160], role: 'anchor', essential: true },
      { type: 'Office Chair', qtyFrom: 'users', w: [55, 75], role: 'core', essential: true },
      { type: 'Task Lamp', qtyFrom: 'users', w: [12, 32], role: 'core' },
      { type: 'Bookcase', qty: 1, w: [80, 120], role: 'core' },
      { type: 'Storage Cabinet', qty: 1, w: [80, 140], role: 'core' },
      { type: 'Accent Chair', qty: 1, w: [60, 85], role: 'secondary' },
      { type: 'Side Table', qty: 1, w: [35, 50], role: 'secondary' },
      { type: 'Wall Art', qty: 2, w: [50, 130], role: 'secondary' },
      { type: 'Planter', qty: 1, w: [20, 50], role: 'secondary' },
    ],
    Large: [
      { type: 'Desk', qtyFrom: 'users', w: [140, 180], role: 'anchor', essential: true },
      { type: 'Office Chair', qtyFrom: 'users', w: [55, 78], role: 'core', essential: true },
      { type: 'Task Lamp', qtyFrom: 'users', w: [12, 32], role: 'core' },
      { type: 'Bookcase', qty: 2, w: [80, 140], role: 'core' },
      { type: 'Storage Cabinet', qty: 1, w: [100, 160], role: 'core' },
      { type: 'Accent Chair', qty: 2, w: [65, 90], role: 'secondary' },
      { type: 'Side Table', qty: 1, w: [35, 55], role: 'secondary' },
      { type: 'Floor Lamp', qty: 1, w: [25, 45], role: 'secondary' },
      { type: 'Wall Art', qty: 3, w: [50, 150], role: 'secondary' },
      { type: 'Planter', qty: 1, w: [25, 55], role: 'secondary' },
    ],
    'Extra Large': [
      { type: 'Desk', qtyFrom: 'users', w: [140, 200], role: 'anchor', essential: true },
      { type: 'Office Chair', qtyFrom: 'users', w: [55, 80], role: 'core', essential: true },
      { type: 'Task Lamp', qtyFrom: 'users', w: [12, 35], role: 'core' },
      { type: 'Bookcase', qty: 2, w: [100, 160], role: 'core' },
      { type: 'Storage Cabinet', qty: 2, w: [100, 180], role: 'core' },
      { type: 'Accent Chair', qty: 2, w: [65, 95], role: 'secondary' },
      { type: 'Side Table', qty: 1, w: [40, 60], role: 'secondary' },
      { type: 'Floor Lamp', qty: 1, w: [25, 50], role: 'secondary' },
      { type: 'Rug', qty: 1, branch: 'Medium', w: [160, 230], role: 'secondary' },
      { type: 'Wall Art', qty: 4, w: [50, 160], role: 'secondary' },
      { type: 'Planter', qty: 2, w: [25, 60], role: 'secondary' },
    ],
  },
  budget: {
    Compact: [
      [500, 1200],
      [1200, 2000],
      [2000, 3500],
      [3500, 6000],
      [6000, 12000],
    ],
    Small: [
      [800, 1800],
      [1800, 3000],
      [3000, 5000],
      [5000, 8000],
      [8000, 16000],
    ],
    Medium: [
      [1200, 2500],
      [2500, 4000],
      [4000, 6500],
      [6500, 10500],
      [10500, 21000],
    ],
    Large: [
      [2000, 3500],
      [3500, 5500],
      [5500, 9000],
      [9000, 15000],
      [15000, 30000],
    ],
    'Extra Large': [
      [3000, 5000],
      [5000, 8000],
      [8000, 13000],
      [13000, 22000],
      [22000, 44000],
    ],
  },
};

export const APARTMENT_BUDGET_AED: Readonly<Record<number, BudgetRows>> = {
  1: [
    [7000, 12000],
    [12000, 18000],
    [18000, 28000],
    [28000, 45000],
    [45000, 90000],
  ],
  2: [
    [10000, 17000],
    [17000, 26000],
    [26000, 40000],
    [40000, 65000],
    [65000, 130000],
  ],
  3: [
    [13000, 22000],
    [22000, 34000],
    [34000, 52000],
    [52000, 82000],
    [82000, 164000],
  ],
  4: [
    [16000, 27000],
    [27000, 42000],
    [42000, 64000],
    [64000, 100000],
    [100000, 200000],
  ],
};

export const STUDIO_BUDGET_AED: Readonly<Record<string, BudgetRows>> = {
  Compact: [
    [3000, 6000],
    [6000, 9000],
    [9000, 14000],
    [14000, 22000],
    [22000, 44000],
  ],
  Small: [
    [4500, 8000],
    [8000, 12000],
    [12000, 18000],
    [18000, 28000],
    [28000, 56000],
  ],
  Medium: [
    [6000, 10000],
    [10000, 15000],
    [15000, 23000],
    [23000, 36000],
    [36000, 72000],
  ],
  Large: [
    [8000, 13000],
    [13000, 20000],
    [20000, 30000],
    [30000, 48000],
    [48000, 96000],
  ],
  'Extra Large': [
    [10000, 16000],
    [16000, 25000],
    [25000, 38000],
    [38000, 60000],
    [60000, 120000],
  ],
};

export const STUDIO_BANDS: Bands = [
  [25, 'Compact'],
  [35, 'Small'],
  [45, 'Medium'],
  [60, 'Large'],
  [Infinity, 'Extra Large'],
];
export const BED_WIDTH_CM: Readonly<Record<string, number>> = {
  Single: 100,
  Queen: 160,
  King: 190,
  'Super King': 210,
};

const ROOM_LOGIC: Readonly<Record<RoomPath, RoomLogic>> = {
  livingRoom: LIVING_ROOM,
  bedroom: BEDROOM,
  diningRoom: DINING_ROOM,
  homeOffice: HOME_OFFICE,
};

const classify = (areaM2: number, bands: Bands): SizeClass => {
  for (const [max, name] of bands) if (areaM2 < max) return name;
  return (bands[bands.length - 1] as readonly [number, SizeClass])[1];
};

/** Size Classification — system-derived from dimensions, never customer-entered. */
export const sizeClass = (path: RoomPath, areaM2: number): SizeClass =>
  classify(areaM2, ROOM_LOGIC[path].bands);

export const studioSizeClass = (areaM2: number): SizeClass => classify(areaM2, STUDIO_BANDS);

const toRange = (row: readonly [number, number]): readonly [Fils, Fils] => [
  aed(row[0]),
  aed(row[1]),
];

/** Room-level target range for the whole composition, at a tier. */
export function roomBudget(path: RoomPath, cls: SizeClass, tier: Tier): readonly [Fils, Fils] {
  return toRange(ROOM_LOGIC[path].budget[cls][TIERS.indexOf(tier)] as readonly [number, number]);
}

export interface ResolvedSlot extends Omit<
  SlotTemplate,
  'qty' | 'qtyFrom' | 'branch' | 'branchFrom'
> {
  readonly qty: number;
  readonly branch: string | null;
}

export interface RoomSpec {
  readonly bedSize?: string;
  readonly capacity?: number;
  readonly users?: number;
}

/** Dining tables are priced per capacity branch 2/4/6/8/10 (AID-LOG-001 §4.3). Rounds up (gap #11). */
export function capacityBranch(capacity: number): 2 | 4 | 6 | 8 | 10 {
  for (const step of [2, 4, 6, 8] as const) if (capacity <= step) return step;
  return 10;
}

/** Default composition for a room path + size class with quantities and branches resolved. */
export function compositionFor(
  path: RoomPath,
  cls: SizeClass,
  spec: RoomSpec = {},
): ResolvedSlot[] {
  return ROOM_LOGIC[path].composition[cls].map((s) => {
    const qty = s.qtyFrom ? Math.max(1, Math.trunc(spec[s.qtyFrom] ?? 1)) : (s.qty as number);
    let branch: string | null = s.branch ?? null;
    if (s.branchFrom === 'bedSize') branch = spec.bedSize ?? 'Queen';
    if (s.branchFrom === 'capacity') branch = String(capacityBranch(spec.capacity ?? 4));
    let w = s.w;
    if (s.type === 'Bed') {
      const bw = BED_WIDTH_CM[spec.bedSize ?? 'Queen'] ?? 160;
      w = [bw - 10, bw + 25];
    }
    return {
      type: s.type,
      w,
      role: s.role,
      qty,
      branch,
      ...(s.essential ? { essential: true as const } : {}),
    };
  });
}

/* ---------------- Project-level budgets (AID-LOG-006/007/008) ---------------- */

export interface ProjectModule {
  readonly path: RoomPath;
  readonly label: string;
  readonly areaM2: number;
  readonly bedSize?: string;
  readonly capacity?: number;
  readonly users?: number;
  readonly floor?: string;
}

export interface ApartmentSpec {
  readonly bedrooms: number;
  /** AID-SPC-007 bedroom sizes, in m², in bedroom order (master first). Missing entries use the default. */
  readonly bedroomAreasM2?: readonly number[];
  /** Bed size per bedroom, in order; the master's may also come from `masterBedSize`. */
  readonly bedSizes?: readonly string[];
  readonly livingAreaM2?: number;
  readonly diningCapacity?: number;
  readonly office?: boolean;
  readonly masterBedSize?: string;
}
export interface VillaSpec extends ApartmentSpec {
  readonly floors?: number;
}
export interface StudioSpec {
  readonly totalAreaM2: number;
  readonly sleepingSetup?: 'Sofa Bed' | 'Single Bed' | 'Queen Bed' | 'King Bed';
}

export function apartmentModules(s: ApartmentSpec): ProjectModule[] {
  const mods: ProjectModule[] = [];
  const n = Math.max(1, Math.trunc(s.bedrooms));
  for (let i = 0; i < n; i++) {
    mods.push({
      path: 'bedroom',
      label: i === 0 ? 'Master Bedroom' : `Bedroom ${i + 1}`,
      areaM2: s.bedroomAreasM2?.[i] ?? (i === 0 ? 18 : 13),
      bedSize:
        (i === 0 ? (s.masterBedSize ?? s.bedSizes?.[0]) : s.bedSizes?.[i]) ??
        (i === 0 ? 'King' : 'Queen'),
    });
  }
  mods.push({ path: 'livingRoom', label: 'Living Room', areaM2: s.livingAreaM2 ?? 24 });
  mods.push({
    path: 'diningRoom',
    label: 'Dining Room',
    areaM2: 14,
    capacity: s.diningCapacity ?? 6,
  });
  if (s.office) mods.push({ path: 'homeOffice', label: 'Home Office', areaM2: 10, users: 1 });
  return mods;
}

export function villaModules(s: VillaSpec): ProjectModule[] {
  const mods: ProjectModule[] = [];
  const n = Math.max(1, Math.trunc(s.bedrooms));
  const floors = s.floors ?? 2;
  for (let i = 0; i < n; i++) {
    mods.push({
      path: 'bedroom',
      label: i === 0 ? 'Master Bedroom' : `Bedroom ${i + 1}`,
      areaM2: s.bedroomAreasM2?.[i] ?? (i === 0 ? 26 : 16),
      bedSize:
        (i === 0 ? (s.masterBedSize ?? s.bedSizes?.[0]) : s.bedSizes?.[i]) ??
        (i === 0 ? 'Super King' : 'Queen'),
      floor: i === 0 ? 'Upper Floor' : `Floor ${Math.min(floors, 1 + Math.floor(i / 3) + 1)}`,
    });
  }
  mods.push({
    path: 'livingRoom',
    label: 'Main Living Room',
    areaM2: s.livingAreaM2 ?? 38,
    floor: 'Ground Floor',
  });
  if (floors > 1)
    mods.push({ path: 'livingRoom', label: 'Family Lounge', areaM2: 24, floor: 'Upper Floor' });
  mods.push({
    path: 'diningRoom',
    label: 'Dining Room',
    areaM2: 20,
    capacity: s.diningCapacity ?? 8,
    floor: 'Ground Floor',
  });
  if (s.office)
    mods.push({
      path: 'homeOffice',
      label: 'Home Office',
      areaM2: 14,
      users: 1,
      floor: 'Ground Floor',
    });
  return mods;
}

/** AID-LOG-006 — the studio is modelled as proportional zones after the sleeping footprint. */
export function studioModules(s: StudioSpec): ProjectModule[] {
  const a = s.totalAreaM2;
  const sleeping = s.sleepingSetup ?? 'Queen Bed';
  const sleepArea = sleeping === 'Sofa Bed' ? 0 : Math.min(a * 0.35, 14);
  const rest = a - sleepArea;
  const mods: ProjectModule[] = [];
  if (sleepArea > 0) {
    mods.push({
      path: 'bedroom',
      label: 'Sleeping Zone',
      areaM2: Math.max(sleepArea, 7),
      bedSize: sleeping === 'King Bed' ? 'King' : sleeping === 'Single Bed' ? 'Single' : 'Queen',
    });
  }
  mods.push({ path: 'livingRoom', label: 'Living Zone', areaM2: Math.max(rest * 0.65, 8) });
  mods.push({
    path: 'diningRoom',
    label: 'Dining Zone',
    areaM2: Math.max(rest * 0.35, 5),
    capacity: a >= 40 ? 4 : 2,
  });
  return mods;
}

const sumRanges = (rs: readonly (readonly [Fils, Fils])[]): readonly [Fils, Fils] => {
  let lo = 0;
  let hi = 0;
  for (const [a, b] of rs) {
    lo += a;
    hi += b;
  }
  return [lo as Fils, hi as Fils];
};

/** AID-LOG-007 §5–6: base range by bedroom count, plus additional-bedroom and office modifiers. */
export function apartmentBudget(s: ApartmentSpec, tier: Tier): readonly [Fils, Fils] {
  const idx = TIERS.indexOf(tier);
  const bedrooms = Math.max(1, Math.trunc(s.bedrooms));
  const base = toRange(
    (APARTMENT_BUDGET_AED[Math.min(4, bedrooms)] as BudgetRows)[idx] as [number, number],
  );
  const parts: (readonly [Fils, Fils])[] = [base];
  for (let i = 4; i < bedrooms; i++) parts.push(roomBudget('bedroom', 'Small', tier));
  if (s.office) parts.push(roomBudget('homeOffice', 'Medium', tier));
  return sumRanges(parts);
}

export function studioBudget(s: StudioSpec, tier: Tier): readonly [Fils, Fils] {
  return toRange(
    (STUDIO_BUDGET_AED[studioSizeClass(s.totalAreaM2)] as BudgetRows)[TIERS.indexOf(tier)] as [
      number,
      number,
    ],
  );
}

/**
 * AID-LOG-008 publishes no villa table, by design: the villa target is the sum of its own room
 * modules at the selected tier (docs/adrs.md, gap 1).
 */
export function villaBudget(s: VillaSpec, tier: Tier): readonly [Fils, Fils] {
  return sumRanges(
    villaModules(s).map((m) => roomBudget(m.path, sizeClass(m.path, m.areaM2), tier)),
  );
}
