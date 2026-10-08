/* ============================================================
   paths.js — Customer paths, size classification, default
   compositions, preferred fit and room budget tiers.
   Implements:
     AID-SPC-001..009  Project path classification + path inputs
     AID-LOG-002  Living Room composition, fit & budget
     AID-LOG-003  Bedroom composition, fit & budget
     AID-LOG-004  Dining Room composition, fit & budget
     AID-LOG-005  Home Office composition, fit & budget
     AID-LOG-007  Full Apartment project budget (module allocation)
     AID-LOG-008  Villa project budget (module allocation)
   Composition roles feed AID-LOG-010 §10:
     anchor | core | secondary
   `w` is the preferred width band in cm — guidance for matching,
   NOT an absolute cut-off filter (AID-LOG-002 §2).
   ============================================================ */

/* Size classification helper: bands are [upperBound, className]. */
function classify(area, bands) {
  for (const [max, name] of bands) if (area < max) return name;
  return bands[bands.length - 1][1];
}

/* ---------------- Living Room — AID-LOG-002 ---------------- */
const LIVING = {
  bands: [[12, 'Compact'], [20, 'Small'], [30, 'Medium'], [45, 'Large'], [Infinity, 'Extra Large']],
  composition: {
    'Compact': [
      { type: 'Sofa', qty: 1, branch: '2', w: [140, 180], role: 'anchor', essential: true },
      { type: 'Coffee Table', qty: 1, w: [60, 90], role: 'core', essential: true },
      { type: 'Side Table', qty: 1, w: [30, 45], role: 'core' },
      { type: 'TV Unit', qty: 1, w: [100, 140], role: 'core' },
      { type: 'Rug', qty: 1, branch: 'Small', w: [120, 180], role: 'secondary' },
      { type: 'Floor Lamp', qty: 1, w: [25, 45], role: 'secondary' },
      { type: 'Wall Art', qty: 1, w: [40, 90], role: 'secondary' },
      { type: 'Vase', qty: 1, w: [10, 30], role: 'secondary' }
    ],
    'Small': [
      { type: 'Sofa', qty: 1, branch: '3', w: [170, 220], role: 'anchor', essential: true },
      { type: 'Accent Chair', qty: 1, w: [60, 80], role: 'core' },
      { type: 'Coffee Table', qty: 1, w: [70, 110], role: 'core', essential: true },
      { type: 'Side Table', qty: 1, w: [35, 50], role: 'core' },
      { type: 'TV Unit', qty: 1, w: [120, 180], role: 'core' },
      { type: 'Rug', qty: 1, branch: 'Medium', w: [160, 230], role: 'secondary' },
      { type: 'Floor Lamp', qty: 1, w: [25, 45], role: 'secondary' },
      { type: 'Wall Art', qty: 1, w: [60, 120], role: 'secondary' },
      { type: 'Vase', qty: 1, w: [10, 30], role: 'secondary' },
      { type: 'Planter', qty: 1, w: [20, 45], role: 'secondary' }
    ],
    'Medium': [
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
      { type: 'Planter', qty: 1, w: [20, 50], role: 'secondary' }
    ],
    'Large': [
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
      { type: 'Planter', qty: 1, w: [25, 55], role: 'secondary' }
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
      { type: 'Planter', qty: 2, w: [25, 60], role: 'secondary' }
    ]
  },
  /* AID-LOG-002 §7 — AED target range for the complete composition. */
  budget: {
    'Compact':     [[800,2000],[2000,3500],[3500,6000],[6000,10000],[10000,20000]],
    'Small':       [[1500,3500],[3500,6000],[6000,10000],[10000,17000],[17000,34000]],
    'Medium':      [[2500,5000],[5000,8500],[8500,14000],[14000,23000],[23000,46000]],
    'Large':       [[4000,7500],[7500,12000],[12000,20000],[20000,33000],[33000,66000]],
    'Extra Large': [[6000,10000],[10000,16000],[16000,27000],[27000,45000],[45000,90000]]
  }
};

/* ---------------- Bedroom — AID-LOG-003 ---------------- */
const BED_W = { 'Single': 100, 'Queen': 160, 'King': 190, 'Super King': 210 };
const BEDROOM = {
  bands: [[9, 'Compact'], [14, 'Small'], [20, 'Medium'], [30, 'Large'], [Infinity, 'Extra Large']],
  composition: {
    'Compact': [
      { type: 'Bed', qty: 1, w: null, role: 'anchor', essential: true, branchFrom: 'bedSize' },
      { type: 'Bedside Table', qty: 1, w: [30, 40], role: 'core', essential: true },
      { type: 'Wardrobe', qty: 1, branch: 'Small', w: [80, 120], role: 'core', essential: true },
      { type: 'Rug', qty: 1, branch: 'Small', w: [120, 180], role: 'secondary' },
      { type: 'Table Lamp', qty: 1, w: [15, 30], role: 'secondary' },
      { type: 'Mirror', qty: 1, w: [40, 70], role: 'secondary' },
      { type: 'Wall Art', qty: 1, w: [40, 90], role: 'secondary' }
    ],
    'Small': [
      { type: 'Bed', qty: 1, w: null, role: 'anchor', essential: true, branchFrom: 'bedSize' },
      { type: 'Bedside Table', qty: 2, w: [35, 50], role: 'core', essential: true },
      { type: 'Wardrobe', qty: 1, branch: 'Medium', w: [100, 160], role: 'core', essential: true },
      { type: 'Chest of Drawers', qty: 1, w: [60, 100], role: 'core' },
      { type: 'Rug', qty: 1, branch: 'Medium', w: [160, 230], role: 'secondary' },
      { type: 'Table Lamp', qty: 2, w: [15, 32], role: 'secondary' },
      { type: 'Mirror', qty: 1, w: [40, 80], role: 'secondary' },
      { type: 'Wall Art', qty: 2, w: [50, 110], role: 'secondary' }
    ],
    'Medium': [
      { type: 'Bed', qty: 1, w: null, role: 'anchor', essential: true, branchFrom: 'bedSize' },
      { type: 'Bedside Table', qty: 2, w: [40, 55], role: 'core', essential: true },
      { type: 'Wardrobe', qty: 1, branch: 'Medium', w: [140, 220], role: 'core', essential: true },
      { type: 'Chest of Drawers', qty: 1, w: [80, 120], role: 'core' },
      { type: 'Accent Chair', qty: 1, w: [60, 80], role: 'core' },
      { type: 'Rug', qty: 1, branch: 'Large', w: [200, 300], role: 'secondary' },
      { type: 'Table Lamp', qty: 2, w: [15, 35], role: 'secondary' },
      { type: 'Mirror', qty: 1, w: [50, 100], role: 'secondary' },
      { type: 'Wall Art', qty: 2, w: [60, 130], role: 'secondary' },
      { type: 'Vase', qty: 1, w: [10, 30], role: 'secondary' }
    ],
    'Large': [
      { type: 'Bed', qty: 1, w: null, role: 'anchor', essential: true, branchFrom: 'bedSize' },
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
      { type: 'Planter', qty: 1, w: [20, 50], role: 'secondary' }
    ],
    'Extra Large': [
      { type: 'Bed', qty: 1, w: null, role: 'anchor', essential: true, branchFrom: 'bedSize' },
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
      { type: 'Planter', qty: 1, w: [25, 55], role: 'secondary' }
    ]
  },
  budget: {
    'Compact':     [[1000,2000],[2000,3500],[3500,6000],[6000,10000],[10000,20000]],
    'Small':       [[1500,3000],[3000,5000],[5000,8000],[8000,14000],[14000,28000]],
    'Medium':      [[2500,4500],[4500,7000],[7000,11000],[11000,18000],[18000,36000]],
    'Large':       [[3500,6000],[6000,9500],[9500,15000],[15000,25000],[25000,50000]],
    'Extra Large': [[5000,8000],[8000,13000],[13000,20000],[20000,33000],[33000,66000]]
  }
};

/* ---------------- Dining Room — AID-LOG-004 ---------------- */
const DINING = {
  bands: [[8, 'Compact'], [12, 'Small'], [18, 'Medium'], [25, 'Large'], [Infinity, 'Extra Large']],
  composition: {
    'Compact': [
      { type: 'Dining Table', qty: 1, w: [80, 140], role: 'anchor', essential: true, branchFrom: 'capacity' },
      { type: 'Dining Chair', qtyFrom: 'capacity', w: [40, 52], role: 'core', essential: true },
      { type: 'Pendant Light', qty: 1, w: [25, 45], role: 'core' },
      { type: 'Wall Art', qty: 1, w: [40, 90], role: 'secondary' },
      { type: 'Vase', qty: 1, w: [10, 28], role: 'secondary' }
    ],
    'Small': [
      { type: 'Dining Table', qty: 1, w: [120, 180], role: 'anchor', essential: true, branchFrom: 'capacity' },
      { type: 'Dining Chair', qtyFrom: 'capacity', w: [42, 55], role: 'core', essential: true },
      { type: 'Pendant Light', qty: 1, w: [30, 55], role: 'core' },
      { type: 'Rug', qty: 1, branch: 'Medium', w: [160, 230], role: 'secondary' },
      { type: 'Sideboard', qty: 1, w: [80, 120], role: 'core' },
      { type: 'Wall Art', qty: 1, w: [50, 110], role: 'secondary' },
      { type: 'Vase', qty: 1, w: [10, 30], role: 'secondary' }
    ],
    'Medium': [
      { type: 'Dining Table', qty: 1, w: [140, 200], role: 'anchor', essential: true, branchFrom: 'capacity' },
      { type: 'Dining Chair', qtyFrom: 'capacity', w: [42, 58], role: 'core', essential: true },
      { type: 'Pendant Light', qty: 1, w: [35, 70], role: 'core' },
      { type: 'Rug', qty: 1, branch: 'Large', w: [200, 300], role: 'secondary' },
      { type: 'Sideboard', qty: 1, w: [120, 180], role: 'core' },
      { type: 'Mirror', qty: 1, w: [50, 110], role: 'secondary' },
      { type: 'Wall Art', qty: 1, w: [60, 130], role: 'secondary' },
      { type: 'Vase', qty: 2, w: [10, 32], role: 'secondary' }
    ],
    'Large': [
      { type: 'Dining Table', qty: 1, w: [160, 240], role: 'anchor', essential: true, branchFrom: 'capacity' },
      { type: 'Dining Chair', qtyFrom: 'capacity', w: [44, 60], role: 'core', essential: true },
      { type: 'Chandelier', qty: 1, w: [45, 90], role: 'core' },
      { type: 'Rug', qty: 1, branch: 'Large', w: [200, 300], role: 'secondary' },
      { type: 'Sideboard', qty: 1, w: [160, 220], role: 'core' },
      { type: 'Console Table', qty: 1, w: [100, 160], role: 'core' },
      { type: 'Mirror', qty: 1, w: [60, 130], role: 'secondary' },
      { type: 'Wall Art', qty: 2, w: [60, 150], role: 'secondary' },
      { type: 'Vase', qty: 2, w: [10, 35], role: 'secondary' },
      { type: 'Planter', qty: 1, w: [25, 55], role: 'secondary' }
    ],
    'Extra Large': [
      { type: 'Dining Table', qty: 1, w: [200, 300], role: 'anchor', essential: true, branchFrom: 'capacity' },
      { type: 'Dining Chair', qtyFrom: 'capacity', w: [44, 62], role: 'core', essential: true },
      { type: 'Chandelier', qty: 2, w: [50, 100], role: 'core' },
      { type: 'Rug', qty: 1, branch: 'Extra Large', w: [250, 350], role: 'secondary' },
      { type: 'Sideboard', qty: 1, w: [180, 260], role: 'core' },
      { type: 'Console Table', qty: 1, w: [120, 180], role: 'core' },
      { type: 'Mirror', qty: 1, w: [70, 150], role: 'secondary' },
      { type: 'Wall Art', qty: 3, w: [60, 170], role: 'secondary' },
      { type: 'Vase', qty: 2, w: [10, 40], role: 'secondary' },
      { type: 'Planter', qty: 2, w: [25, 60], role: 'secondary' }
    ]
  },
  budget: {
    'Compact':     [[500,1200],[1200,2000],[2000,3500],[3500,6000],[6000,12000]],
    'Small':       [[1000,2000],[2000,3500],[3500,5500],[5500,9000],[9000,18000]],
    'Medium':      [[1500,3000],[3000,5000],[5000,8000],[8000,13000],[13000,26000]],
    'Large':       [[2500,4500],[4500,7000],[7000,11000],[11000,18000],[18000,36000]],
    'Extra Large': [[3500,6000],[6000,9500],[9500,15000],[15000,25000],[25000,50000]]
  }
};

/* ---------------- Home Office — AID-LOG-005 ---------------- */
const OFFICE = {
  bands: [[6, 'Compact'], [10, 'Small'], [15, 'Medium'], [22, 'Large'], [Infinity, 'Extra Large']],
  composition: {
    'Compact': [
      { type: 'Desk', qty: 1, w: [80, 120], role: 'anchor', essential: true },
      { type: 'Office Chair', qtyFrom: 'users', w: [55, 70], role: 'core', essential: true },
      { type: 'Task Lamp', qty: 1, w: [12, 28], role: 'core' },
      { type: 'Bookcase', qty: 1, w: [50, 80], role: 'core' },
      { type: 'Wall Art', qty: 1, w: [40, 90], role: 'secondary' }
    ],
    'Small': [
      { type: 'Desk', qtyFrom: 'users', w: [100, 140], role: 'anchor', essential: true },
      { type: 'Office Chair', qtyFrom: 'users', w: [55, 72], role: 'core', essential: true },
      { type: 'Task Lamp', qtyFrom: 'users', w: [12, 30], role: 'core' },
      { type: 'Bookcase', qty: 1, w: [60, 100], role: 'core' },
      { type: 'Storage Cabinet', qty: 1, w: [60, 110], role: 'core' },
      { type: 'Wall Art', qty: 1, w: [50, 110], role: 'secondary' },
      { type: 'Planter', qty: 1, w: [20, 45], role: 'secondary' }
    ],
    'Medium': [
      { type: 'Desk', qtyFrom: 'users', w: [120, 160], role: 'anchor', essential: true },
      { type: 'Office Chair', qtyFrom: 'users', w: [55, 75], role: 'core', essential: true },
      { type: 'Task Lamp', qtyFrom: 'users', w: [12, 32], role: 'core' },
      { type: 'Bookcase', qty: 1, w: [80, 120], role: 'core' },
      { type: 'Storage Cabinet', qty: 1, w: [80, 140], role: 'core' },
      { type: 'Accent Chair', qty: 1, w: [60, 85], role: 'secondary' },
      { type: 'Side Table', qty: 1, w: [35, 50], role: 'secondary' },
      { type: 'Wall Art', qty: 2, w: [50, 130], role: 'secondary' },
      { type: 'Planter', qty: 1, w: [20, 50], role: 'secondary' }
    ],
    'Large': [
      { type: 'Desk', qtyFrom: 'users', w: [140, 180], role: 'anchor', essential: true },
      { type: 'Office Chair', qtyFrom: 'users', w: [55, 78], role: 'core', essential: true },
      { type: 'Task Lamp', qtyFrom: 'users', w: [12, 32], role: 'core' },
      { type: 'Bookcase', qty: 2, w: [80, 140], role: 'core' },
      { type: 'Storage Cabinet', qty: 1, w: [100, 160], role: 'core' },
      { type: 'Accent Chair', qty: 2, w: [65, 90], role: 'secondary' },
      { type: 'Side Table', qty: 1, w: [35, 55], role: 'secondary' },
      { type: 'Floor Lamp', qty: 1, w: [25, 45], role: 'secondary' },
      { type: 'Wall Art', qty: 3, w: [50, 150], role: 'secondary' },
      { type: 'Planter', qty: 1, w: [25, 55], role: 'secondary' }
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
      { type: 'Planter', qty: 2, w: [25, 60], role: 'secondary' }
    ]
  },
  budget: {
    'Compact':     [[500,1200],[1200,2000],[2000,3500],[3500,6000],[6000,12000]],
    'Small':       [[800,1800],[1800,3000],[3000,5000],[5000,8000],[8000,16000]],
    'Medium':      [[1200,2500],[2500,4000],[4000,6500],[6500,10500],[10500,21000]],
    'Large':       [[2000,3500],[3500,5500],[5500,9000],[9000,15000],[15000,30000]],
    'Extra Large': [[3000,5000],[5000,8000],[8000,13000],[13000,22000],[22000,44000]]
  }
};

const ROOM_LOGIC = { livingRoom: LIVING, bedroom: BEDROOM, diningRoom: DINING, homeOffice: OFFICE };

/* ---------------- Project-level budget targets ----------------
   AID-LOG-007 §5 (Full Apartment, by bedroom count; Home Office is a
   modifier, not part of the base range) and AID-LOG-006 §budget (Studio,
   by size class). AID-LOG-008 deliberately publishes no villa table —
   "Villa Budget is driven by actual room modules and their composition
   requirements, not by bedroom count or number of floors alone" — so the
   villa target is summed from its own room modules at the selected tier. */
const APARTMENT_BUDGET = {
  1: [[7000,12000],[12000,18000],[18000,28000],[28000,45000],[45000,90000]],
  2: [[10000,17000],[17000,26000],[26000,40000],[40000,65000],[65000,130000]],
  3: [[13000,22000],[22000,34000],[34000,52000],[52000,82000],[82000,164000]],
  4: [[16000,27000],[27000,42000],[42000,64000],[64000,100000],[100000,200000]]
};
const STUDIO_BUDGET = {
  'Compact':     [[3000,6000],[6000,9000],[9000,14000],[14000,22000],[22000,44000]],
  'Small':       [[4500,8000],[8000,12000],[12000,18000],[18000,28000],[28000,56000]],
  'Medium':      [[6000,10000],[10000,15000],[15000,23000],[23000,36000],[36000,72000]],
  'Large':       [[8000,13000],[13000,20000],[20000,30000],[30000,48000],[48000,96000]],
  'Extra Large': [[10000,16000],[16000,25000],[25000,38000],[38000,60000],[60000,120000]]
};
const STUDIO_BANDS = [[25,'Compact'],[35,'Small'],[45,'Medium'],[60,'Large'],[Infinity,'Extra Large']];

export const studioClass = a => classify(Number(a) || 0, STUDIO_BANDS);

/**
 * Project-level AED target range for a project path, tier index and inputs.
 * Full Apartment: AID-LOG-007 §5 base range + Home Office modifier (§6).
 * Studio: AID-LOG-006 size-class table.
 * Villa: summed from the actual room modules (AID-LOG-008 §5).
 */
export function projectBudget(pathId, tierIndex, spec) {
  if (pathId === 'studio') {
    const rows = STUDIO_BUDGET[studioClass(spec.totalArea)];
    return rows ? rows[tierIndex] : null;
  }
  if (pathId === 'fullApartment') {
    const n = Math.min(4, Math.max(1, Number(spec.bedrooms) || 1));
    const base = APARTMENT_BUDGET[n][tierIndex].slice();
    const extra = Math.max(0, (Number(spec.bedrooms) || 1) - 4);
    if (extra) {                                   // §6 Additional Bedroom modifier
      const br = BEDROOM.budget['Small'][tierIndex];
      base[0] += br[0] * extra; base[1] += br[1] * extra;
    }
    if (spec.officeYesNo === 'Yes') {              // §6 Home Office modifier
      const ho = OFFICE.budget['Medium'][tierIndex];
      base[0] += ho[0]; base[1] += ho[1];
    }
    return base;
  }
  if (pathId === 'villa') {
    const mods = pathById('villa').modules(spec);
    return mods.reduce((acc, m) => {
      const r = roomBudget(m.path, sizeClass(m.path, m.area), tierIndex);
      return [acc[0] + r[0], acc[1] + r[1]];
    }, [0, 0]);
  }
  return null;
}

/* ---------------- AID-SPC-001 : the eight project paths ---------------- */
export const PATHS = [
  {
    id: 'livingRoom', label: 'Living Room', spc: 'AID-SPC-002', log: 'AID-LOG-002',
    kind: 'room', icon: 'sofa',
    blurb: 'One living room, measured and fully composed.',
    inputs: ['dimensions', 'media', 'style', 'colour', 'budget']
  },
  {
    id: 'bedroom', label: 'Bedroom', spc: 'AID-SPC-003', log: 'AID-LOG-003',
    kind: 'room', icon: 'bed',
    blurb: 'Bed size anchors the room; everything else fits around it.',
    inputs: ['dimensions', 'bedSize', 'media', 'style', 'colour', 'budget']
  },
  {
    id: 'diningRoom', label: 'Dining Room', spc: 'AID-SPC-004', log: 'AID-LOG-004',
    kind: 'room', icon: 'dining',
    blurb: 'Seating capacity drives the table, chairs and circulation.',
    inputs: ['dimensions', 'capacity', 'media', 'style', 'colour', 'budget']
  },
  {
    id: 'homeOffice', label: 'Home Office', spc: 'AID-SPC-005', log: 'AID-LOG-005',
    kind: 'room', icon: 'desk',
    blurb: 'Workspaces first, then storage, lighting and comfort.',
    inputs: ['dimensions', 'users', 'media', 'style', 'colour', 'budget']
  },
  {
    id: 'studio', label: 'Studio Apartment', spc: 'AID-SPC-006', log: 'AID-LOG-006',
    kind: 'project', icon: 'studio',
    blurb: 'One integrated space: sleeping, living and dining together.',
    inputs: ['totalArea', 'sleepingSetup', 'media', 'style', 'colour', 'budget'],
    modules: s => {
      /* AID-LOG-006 — the studio is evaluated after the sleeping footprint;
         for MVP the integrated space is modelled as proportional zones. */
      const a = Number(s.totalArea) || 35;
      const sleepArea = s.sleepingSetup === 'Sofa Bed' ? 0 : Math.min(a * 0.35, 14);
      const rest = a - sleepArea;
      const mods = [];
      if (sleepArea > 0) mods.push({ path: 'bedroom', label: 'Sleeping Zone', area: Math.max(sleepArea, 7), bedSize: s.sleepingSetup === 'King Bed' ? 'King' : s.sleepingSetup === 'Single Bed' ? 'Single' : 'Queen' });
      mods.push({ path: 'livingRoom', label: 'Living Zone', area: Math.max(rest * 0.65, 8) });
      mods.push({ path: 'diningRoom', label: 'Dining Zone', area: Math.max(rest * 0.35, 5), capacity: a >= 40 ? 4 : 2 });
      return mods;
    }
  },
  {
    id: 'fullApartment', label: 'Full Apartment', spc: 'AID-SPC-007', log: 'AID-LOG-007',
    kind: 'project', icon: 'apartment',
    blurb: 'Several rooms coordinated as one project with one budget.',
    inputs: ['bedrooms', 'bedroomSizes', 'livingArea', 'diningCapacity', 'officeYesNo', 'consistency', 'style', 'colour', 'budget'],
    modules: s => {
      const mods = [];
      const n = Number(s.bedrooms) || 1;
      for (let i = 0; i < n; i++) {
        mods.push({
          path: 'bedroom',
          label: i === 0 ? 'Master Bedroom' : `Bedroom ${i + 1}`,
          area: i === 0 ? 18 : 13,
          bedSize: i === 0 ? (s.masterBedSize || 'King') : 'Queen'
        });
      }
      mods.push({ path: 'livingRoom', label: 'Living Room', area: Number(s.livingArea) || 24 });
      mods.push({ path: 'diningRoom', label: 'Dining Room', area: 14, capacity: Number(s.diningCapacity) || 6 });
      if (s.officeYesNo === 'Yes') mods.push({ path: 'homeOffice', label: 'Home Office', area: 10, users: 1 });
      return mods;
    }
  },
  {
    id: 'villa', label: 'Villa', spc: 'AID-SPC-008', log: 'AID-LOG-008',
    kind: 'project', icon: 'villa',
    blurb: 'Multi-floor project with repeated-space preferences.',
    inputs: ['floors', 'bedrooms', 'livingArea', 'diningCapacity', 'officeYesNo', 'consistency', 'style', 'colour', 'budget'],
    modules: s => {
      const mods = [];
      const n = Number(s.bedrooms) || 4;
      const floors = Number(s.floors) || 2;
      for (let i = 0; i < n; i++) {
        mods.push({
          path: 'bedroom',
          label: i === 0 ? 'Master Bedroom' : `Bedroom ${i + 1}`,
          area: i === 0 ? 26 : 16,
          bedSize: i === 0 ? (s.masterBedSize || 'Super King') : 'Queen',
          floor: i === 0 ? 'Upper Floor' : `Floor ${Math.min(floors, 1 + Math.floor(i / 3) + 1)}`
        });
      }
      mods.push({ path: 'livingRoom', label: 'Main Living Room', area: Number(s.livingArea) || 38, floor: 'Ground Floor' });
      if (floors > 1) mods.push({ path: 'livingRoom', label: 'Family Lounge', area: 24, floor: 'Upper Floor' });
      mods.push({ path: 'diningRoom', label: 'Dining Room', area: 20, capacity: Number(s.diningCapacity) || 8, floor: 'Ground Floor' });
      if (s.officeYesNo === 'Yes') mods.push({ path: 'homeOffice', label: 'Home Office', area: 14, users: 1, floor: 'Ground Floor' });
      return mods;
    }
  },
  {
    id: 'individualProduct', label: 'Individual Product', spc: 'AID-SPC-009', log: 'AID-LOG-001',
    kind: 'product', icon: 'lamp',
    blurb: 'One product type, ranked against your preferences.',
    inputs: ['productType', 'practical', 'style', 'colour', 'budget']
  }
];

export const pathById = id => PATHS.find(p => p.id === id);

/* ---------- Public helpers used by the engine ---------- */

/** Area in m² from length × width in metres. */
export const area = (l, w) => (Number(l) || 0) * (Number(w) || 0);

/** Size Classification for a room path — system-derived, never customer-entered. */
export function sizeClass(pathId, areaM2) {
  const L = ROOM_LOGIC[pathId];
  return L ? classify(areaM2, L.bands) : null;
}

/** Default composition slots for a path + size class, with quantities resolved. */
export function compositionFor(pathId, cls, spec = {}) {
  const L = ROOM_LOGIC[pathId];
  if (!L) return [];
  const slots = L.composition[cls] || [];
  return slots.map(s => {
    const qty = s.qtyFrom ? Math.max(1, Number(spec[s.qtyFrom]) || 1) : s.qty;
    let branch = s.branch;
    if (s.branchFrom === 'bedSize') branch = spec.bedSize || 'Queen';
    if (s.branchFrom === 'capacity') branch = String(nearestCapacity(Number(spec.capacity) || 4));
    let w = s.w;
    if (s.type === 'Bed') {
      const bw = BED_W[spec.bedSize || 'Queen'];
      w = [bw - 10, bw + 25];
    }
    return { ...s, qty, branch, w };
  });
}

/** Dining tables are priced per capacity branch 2/4/6/8/10 (AID-LOG-001 §4.3). */
export function nearestCapacity(c) {
  const steps = [2, 4, 6, 8, 10];
  return steps.reduce((best, s) => (c <= s && best === null ? s : best), null) ?? 10;
}

/** Room-level AED budget range for a path + size class + tier (AID-LOG-002..005 §budget). */
export function roomBudget(pathId, cls, tierIndex) {
  const L = ROOM_LOGIC[pathId];
  if (!L) return null;
  const rows = L.budget[cls];
  return rows ? rows[tierIndex] : null;
}

export { BED_W };
