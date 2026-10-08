/**
 * Controlled vocabularies enforced by CHECK constraints.
 *
 * Every CHECK of the form `column = ANY (ARRAY[...])` is named `<table>_<column>_enum` and must be
 * listed here. `test/vocab.test.ts` fails if the database and this file disagree in either
 * direction, so a value cannot be added to one without the other.
 */

export interface EnumColumn {
  readonly table: string;
  readonly column: string;
  readonly values: readonly string[];
}

const e = (table: string, column: string, values: readonly string[]): EnumColumn => ({
  table,
  column,
  values,
});

export const COLOUR_FAMILIES = [
  'white',
  'beige',
  'grey',
  'black',
  'brown',
  'natural',
  'green',
  'blue',
  'red',
  'orange',
  'yellow',
  'pink',
  'purple',
  'gold',
  'silver',
  'brass',
  'bronze',
  'multicolour',
] as const;

export const STYLES = [
  'modern',
  'contemporary',
  'mcm',
  'scandinavian',
  'minimalist',
  'japandi',
  'industrial',
  'classic',
  'traditional',
] as const;

export const MATERIAL_FAMILIES = [
  'Wood',
  'Metal',
  'Fabric',
  'Leather',
  'Glass',
  'Stone',
  'Rattan',
  'Ceramic',
] as const;

export const BUDGET_TIERS = ['Essential', 'Value', 'Standard', 'Premium', 'Luxury'] as const;

export const PROJECT_PATHS = [
  'livingRoom',
  'bedroom',
  'diningRoom',
  'homeOffice',
  'studio',
  'fullApartment',
  'villa',
  'individualProduct',
] as const;

export const SIZE_CLASSES = ['Compact', 'Small', 'Medium', 'Large', 'Extra Large'] as const;

export const EMIRATES = [
  'Abu Dhabi',
  'Dubai',
  'Sharjah',
  'Ajman',
  'Umm Al Quwain',
  'Ras Al Khaimah',
  'Fujairah',
] as const;

export const ENUMS: readonly EnumColumn[] = [
  // identity
  e('identity.customer', 'locale', ['en', 'ar']),
  e('identity.customer', 'status', ['Active', 'Erased']),
  e('identity.customer_address', 'emirate', EMIRATES),
  e('identity.ops_user', 'role', ['ops_admin', 'ops_catalogue', 'ops_support', 'ops_finance']),
  e('identity.ops_user', 'status', ['Active', 'Disabled']),
  e('identity.otp_challenge', 'channel', ['sms', 'whatsapp', 'email']),
  e('identity.seller_user', 'role', ['seller_owner', 'seller_manager', 'seller_staff']),
  e('identity.seller_user', 'status', ['Invited', 'Active', 'Disabled']),
  e('identity.refresh_token_family', 'revoked_reason', ['logout', 'reuse_detected', 'admin']),
  e('identity.device_token', 'platform', ['ios', 'android', 'web']),

  // catalogue
  e('catalogue.brand', 'status', ['Active', 'Inactive']),
  e('catalogue.product', 'primary_colour', COLOUR_FAMILIES),
  e('catalogue.product', 'secondary_colour', COLOUR_FAMILIES),
  e('catalogue.product', 'primary_style', STYLES),
  e('catalogue.product', 'secondary_style', STYLES),
  e('catalogue.product', 'material_family', MATERIAL_FAMILIES),
  e('catalogue.product', 'data_status', ['Incomplete', 'Ready for Review', 'Verified']),
  e('catalogue.product', 'lifecycle', ['Active', 'Inactive']),
  e('catalogue.partner', 'status', [
    'Requested',
    'Under Review',
    'Approved/Agreement Pending',
    'Active',
    'Inactive',
  ]),
  e('catalogue.partner_location', 'emirate', EMIRATES),
  e('catalogue.partner_location', 'status', ['Active', 'Inactive']),
  e('catalogue.seller_offer', 'availability', ['In Stock', 'Low Stock', 'Out of Stock']),
  e('catalogue.seller_offer', 'viewing_status', [
    'On Display',
    'Viewable on Request',
    'Not Viewable',
  ]),
  e('catalogue.seller_offer', 'offer_status', ['Active', 'Inactive']),
  e('catalogue.import_job', 'state', ['Uploaded', 'Validating', 'Validated', 'Imported', 'Failed']),
  e('catalogue.import_row', 'status', ['Valid', 'Invalid', 'Imported']),
  e('catalogue.compat_map_version', 'kind', ['style', 'colour', 'material']),

  // recommendation
  e('recommendation.project', 'path_id', PROJECT_PATHS),
  e('recommendation.project', 'budget_tier', BUDGET_TIERS),
  e('recommendation.project', 'size_class', SIZE_CLASSES),
  e('recommendation.project', 'state', ['Draft', 'In Progress', 'Ready for Recommendation']),
  e('recommendation.project_module', 'room_path', PROJECT_PATHS),
  e('recommendation.recommendation_run', 'size_class', SIZE_CLASSES),
  e('recommendation.recommendation_run', 'state', [
    'Processing',
    'Completed',
    'Limited Inventory',
    'Failed',
  ]),
  e('recommendation.composition', 'objective', [
    'best_overall',
    'best_value',
    'best_style',
    'premium',
  ]),
  e('recommendation.composition', 'state', ['Valid', 'Rebuild', 'Rejected']),
  e('recommendation.composition_item', 'role', ['anchor', 'core', 'secondary']),
  e('recommendation.visualization', 'fidelity', ['Product-Faithful', 'Concept']),
  e('recommendation.visualization', 'state', ['Current', 'Refresh Required']),

  // viewing
  e('viewing.viewing_request', 'state', [
    'Draft',
    'Awaiting Seller Confirmation',
    'Awaiting Deposit',
    'Confirmed',
    'Completed',
    'No-show',
    'Cancelled',
  ]),
  e('viewing.viewing_stop', 'confirmation_state', ['Pending', 'Confirmed', 'Declined']),
  e('viewing.viewing_stop', 'attendance', ['Attended', 'No-show']),
  e('viewing.viewing_deposit', 'state', [
    'Pending',
    'Paid',
    'Credited',
    'Refunded',
    'Non-refundable',
  ]),
  e('viewing.attribution_event', 'stage', [
    'Recommended',
    'Requested',
    'Confirmed',
    'Viewed',
    'Purchased',
    'Not Purchased',
  ]),

  // commerce
  e('commerce.purchase_request', 'validation_state', [
    'Validation Pending',
    'Validated',
    'Rebuild Required',
  ]),
  e('commerce.reservation', 'state', ['Active', 'Converted', 'Released', 'Expired']),
  e('commerce.confirmation_task', 'task_type', ['viewing', 'purchase', 'fulfilment']),
  e('commerce.confirmation_task', 'channel', ['app', 'whatsapp', 'sms', 'phone']),
  e('commerce.confirmation_task', 'response', ['Confirmed', 'Declined']),
  e('commerce.payment', 'purpose', ['Order', 'ViewingDeposit']),
  e('commerce.payment', 'state', [
    'Pending',
    'Authorized',
    'Successful',
    'Failed',
    'Voided',
    'Refunded',
  ]),
  e('commerce.payment_attempt', 'kind', ['authorize', 'capture', 'void', 'refund']),
  e('commerce.payment_attempt', 'outcome', ['Succeeded', 'Failed', 'Pending']),
  e('commerce.refund', 'state', ['Pending', 'Succeeded', 'Failed']),
  e('commerce.ledger_entry', 'direction', ['debit', 'credit']),

  // fulfilment
  e('fulfilment.order_line', 'state', [
    'Confirmed',
    'Preparing',
    'Ready for Dispatch',
    'Dispatched',
    'Delivered',
    'Receipt Confirmed',
    'Cancelled',
    'Refunded',
  ]),
  e('fulfilment.order_line', 'settlement_state', [
    'Not Eligible',
    'Eligible',
    'On Hold',
    'Included',
    'Paid',
    'Adjusted',
  ]),
  e('fulfilment.issue', 'flag', [
    'Delayed',
    'Delivery Failed',
    'Damaged',
    'Missing',
    'Cancellation Requested',
    'Return Requested',
    'Disputed',
  ]),
  e('fulfilment.issue', 'state', ['Open', 'Partner Handling', 'Resolved', 'Refunded', 'Rejected']),

  // settlement
  e('settlement.settlement_run', 'state', ['Draft', 'Approved', 'Paid']),
  e('settlement.settlement_line', 'kind', ['Sale', 'Clawback']),

  // audit
  e('audit.event', 'actor_type', ['customer', 'guest', 'seller_user', 'ops_user', 'system']),

  // platform
  e('platform.job', 'status', ['Pending', 'Running', 'Succeeded', 'Failed', 'Dead']),
  e('platform.idempotency_key', 'status', ['InProgress', 'Completed']),
];

/**
 * Legal state transitions, mirrored into `platform.state_transition` and enforced by triggers.
 * Machine names equal the table names they guard.
 */
export const STATE_TRANSITIONS = {
  viewing_request: {
    table: 'viewing.viewing_request',
    column: 'state',
    edges: [
      ['Draft', 'Awaiting Seller Confirmation'],
      ['Draft', 'Awaiting Deposit'],
      ['Draft', 'Cancelled'],
      ['Awaiting Seller Confirmation', 'Awaiting Deposit'],
      ['Awaiting Seller Confirmation', 'Cancelled'],
      ['Awaiting Deposit', 'Confirmed'],
      ['Awaiting Deposit', 'Cancelled'],
      ['Confirmed', 'Completed'],
      ['Confirmed', 'No-show'],
      ['Confirmed', 'Cancelled'],
    ],
  },
  viewing_deposit: {
    table: 'viewing.viewing_deposit',
    column: 'state',
    edges: [
      ['Pending', 'Paid'],
      ['Paid', 'Credited'],
      ['Paid', 'Refunded'],
      ['Paid', 'Non-refundable'],
    ],
  },
  reservation: {
    table: 'commerce.reservation',
    column: 'state',
    edges: [
      ['Active', 'Converted'],
      ['Active', 'Released'],
      ['Active', 'Expired'],
    ],
  },
  payment: {
    table: 'commerce.payment',
    column: 'state',
    edges: [
      ['Pending', 'Authorized'],
      ['Pending', 'Failed'],
      ['Authorized', 'Successful'],
      ['Authorized', 'Voided'],
      ['Authorized', 'Failed'],
      ['Successful', 'Refunded'],
    ],
  },
  order_line: {
    table: 'fulfilment.order_line',
    column: 'state',
    edges: [
      ['Confirmed', 'Preparing'],
      ['Confirmed', 'Cancelled'],
      ['Confirmed', 'Refunded'],
      ['Preparing', 'Ready for Dispatch'],
      ['Preparing', 'Cancelled'],
      ['Preparing', 'Refunded'],
      ['Ready for Dispatch', 'Dispatched'],
      ['Ready for Dispatch', 'Cancelled'],
      ['Ready for Dispatch', 'Refunded'],
      ['Dispatched', 'Delivered'],
      ['Dispatched', 'Refunded'],
      ['Delivered', 'Receipt Confirmed'],
      ['Delivered', 'Refunded'],
      ['Receipt Confirmed', 'Refunded'],
    ],
  },
  issue: {
    table: 'fulfilment.issue',
    column: 'state',
    edges: [
      ['Open', 'Partner Handling'],
      ['Open', 'Resolved'],
      ['Open', 'Refunded'],
      ['Open', 'Rejected'],
      ['Partner Handling', 'Resolved'],
      ['Partner Handling', 'Refunded'],
      ['Partner Handling', 'Rejected'],
    ],
  },
  partner_status: {
    table: 'catalogue.partner',
    column: 'status',
    edges: [
      ['Requested', 'Under Review'],
      ['Under Review', 'Approved/Agreement Pending'],
      ['Under Review', 'Requested'],
      ['Approved/Agreement Pending', 'Active'],
      ['Approved/Agreement Pending', 'Under Review'],
      ['Active', 'Inactive'],
      ['Inactive', 'Active'],
    ],
  },
  data_status: {
    table: 'catalogue.product',
    column: 'data_status',
    edges: [
      ['Incomplete', 'Ready for Review'],
      ['Ready for Review', 'Verified'],
      ['Ready for Review', 'Incomplete'],
      ['Verified', 'Ready for Review'],
    ],
  },
} as const satisfies Record<
  string,
  { table: string; column: string; edges: readonly (readonly [string, string])[] }
>;

export type StateMachineName = keyof typeof STATE_TRANSITIONS;
