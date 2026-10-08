import type { Tone } from '@aidooi/ui-web';

/** One mapping per domain, reused by every screen that shows that status. */
export const LINE_TONE: Record<string, Tone> = {
  Confirmed: 'neutral',
  Preparing: 'neutral',
  'Ready for Dispatch': 'neutral',
  Dispatched: 'neutral',
  Delivered: 'ok',
  'Receipt Confirmed': 'ok',
  Cancelled: 'err',
  Refunded: 'err',
};
export const DATA_TONE: Record<string, Tone> = {
  Incomplete: 'warn',
  'Ready for Review': 'neutral',
  Verified: 'ok',
};
export const AVAILABILITY_TONE: Record<string, Tone> = {
  'In Stock': 'ok',
  'Low Stock': 'warn',
  'Out of Stock': 'err',
};
export const ISSUE_TONE: Record<string, Tone> = {
  Open: 'err',
  'Partner Handling': 'warn',
  Resolved: 'ok',
  Refunded: 'neutral',
  Rejected: 'neutral',
};
export const RUN_TONE: Record<string, Tone> = { Draft: 'neutral', Approved: 'warn', Paid: 'ok' };
export const IMPORT_TONE: Record<string, Tone> = {
  Uploaded: 'neutral',
  Validating: 'neutral',
  Validated: 'ok',
  Imported: 'ok',
  Failed: 'err',
};

/** Tone map keyed by the *displayed* (localised) label, which is what `StatusPill` receives. */
export const labelled = (
  labels: Readonly<Record<string, string>>,
  tones: Readonly<Record<string, Tone>>,
): Record<string, Tone> =>
  Object.fromEntries(Object.entries(labels).map(([k, label]) => [label, tones[k] ?? 'neutral']));
export const MEMBER_TONE: Record<string, Tone> = {
  Invited: 'warn',
  Active: 'ok',
  Disabled: 'neutral',
};
