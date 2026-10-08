/** AID-DATA-007/008/009 and AID-SPC §8 controlled vocabularies. */

export const TIERS = ['Essential', 'Value', 'Standard', 'Premium', 'Luxury'] as const;
export type Tier = (typeof TIERS)[number];
export const tierIndex = (t: Tier): number => TIERS.indexOf(t);

export const STYLE_IDS = [
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
export type StyleId = (typeof STYLE_IDS)[number];
/** `assisted`: the customer asked AIDOOi to choose, so there is no stated preference to conflict with. */
export type StylePreference = StyleId | 'assisted';

export const STYLES: readonly { id: StyleId; label: string; family: string }[] = [
  { id: 'modern', label: 'Modern', family: 'Modern' },
  { id: 'contemporary', label: 'Contemporary', family: 'Contemporary' },
  { id: 'mcm', label: 'Mid-Century Modern', family: 'Modern' },
  { id: 'scandinavian', label: 'Scandinavian', family: 'Minimal / Nordic' },
  { id: 'minimalist', label: 'Minimalist', family: 'Minimal / Nordic' },
  { id: 'japandi', label: 'Japandi', family: 'Japanese / Hybrid' },
  { id: 'industrial', label: 'Industrial', family: 'Industrial' },
  { id: 'classic', label: 'Classic', family: 'Classic' },
  { id: 'traditional', label: 'Traditional', family: 'Traditional' },
];

export const COLOUR_IDS = [
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
export type ColourId = (typeof COLOUR_IDS)[number];
export type ColourPreference = ColourId | 'assisted';

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
export type MaterialFamily = (typeof MATERIAL_FAMILIES)[number];

export const AVAILABILITY = ['In Stock', 'Low Stock', 'Out of Stock'] as const;
export type Availability = (typeof AVAILABILITY)[number];

export const VIEWING_STATUS = ['On Display', 'Viewable on Request', 'Not Viewable'] as const;
export type ViewingStatus = (typeof VIEWING_STATUS)[number];

export const OFFER_STATUS = ['Active', 'Inactive'] as const;
export type OfferStatus = (typeof OFFER_STATUS)[number];

export const LIFECYCLE = ['Active', 'Inactive'] as const;
export type Lifecycle = (typeof LIFECYCLE)[number];
