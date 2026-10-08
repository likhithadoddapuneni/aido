export interface ScanResultLike {
  readonly viewingRequestId: string;
  readonly checkedInAt: string;
  readonly buyerName: string | null;
  readonly scheduledAt: string;
  readonly products: readonly { readonly name: string; readonly quantity: number }[];
}

/** How the check-in screen should read a scan. */
export type ScanView =
  | { readonly kind: 'checked_in'; readonly result: ScanResultLike }
  /** The buyer was already checked in (a second scan, or a colleague did it): reassure, don't alarm. */
  | { readonly kind: 'already'; readonly result: ScanResultLike }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'not_yet' }
  | { readonly kind: 'not_ours' }
  | { readonly kind: 'closed' }
  | { readonly kind: 'error'; readonly code: string };

/** The check-in time is the first scan's; a result much older than this request means it was already done. */
export const ALREADY_AFTER_MS = 10_000;

export function interpretScan(result: ScanResultLike, requestedAtMs: number): ScanView {
  const first = new Date(result.checkedInAt).getTime();
  return requestedAtMs - first > ALREADY_AFTER_MS
    ? { kind: 'already', result }
    : { kind: 'checked_in', result };
}

const BY_CODE: Record<string, ScanView['kind']> = {
  pass_invalid: 'invalid',
  pass_expired: 'expired',
  pass_not_yet_valid: 'not_yet',
  not_found: 'not_ours',
  viewing_not_active: 'closed',
};

/** Map a problem from the scan endpoint to a view. Unknown codes fall through to a generic error. */
export function interpretScanProblem(code: string): ScanView {
  const kind = BY_CODE[code];
  switch (kind) {
    case 'invalid':
    case 'expired':
    case 'not_yet':
    case 'not_ours':
    case 'closed':
      return { kind };
    default:
      return { kind: 'error', code };
  }
}

/** A hand-typed code has no QR framing: tidy whitespace so a pasted/typed pass works the same as a scan. */
export const normalisePass = (raw: string): string => raw.replace(/\s+/g, '').trim();
