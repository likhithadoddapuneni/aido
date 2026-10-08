import { unwrap, type Api } from '@aidooi/api-client';
import type { OfferPatch } from '../domain/stock.ts';

/**
 * Every call the app makes, as plain functions over an `Api`. No React, no Expo: screens, tests and the
 * smoke script all use this one layer, so what is tested is what ships.
 */
export function createSellerData(api: Api) {
  const http = api.http;
  return {
    /* ---- staff sign-in ---- */
    login: (b: { email: string; password: string; totpCode: string }) =>
      unwrap(http.POST('/v1/auth/staff/login', { body: b })),
    acceptInvite: (b: { token: string; password: string }) =>
      unwrap(http.POST('/v1/auth/staff/accept-invite', { body: b })),
    mfaEnroll: (b: { email: string; password: string }) =>
      unwrap(http.POST('/v1/auth/staff/mfa/enroll', { body: b })),
    mfaVerify: (b: { email: string; password: string; totpCode: string }) =>
      unwrap(http.POST('/v1/auth/staff/mfa/verify', { body: b })),
    logout: (refreshToken: string) =>
      unwrap(http.POST('/v1/auth/logout', { body: { refreshToken } })),

    /* ---- confirmation tasks ---- */
    viewingTasks: () => unwrap(http.GET('/v1/seller/viewing-tasks')),
    purchaseTasks: () => unwrap(http.GET('/v1/seller/purchase-tasks')),
    respondViewing: (
      id: string,
      b: { response: 'Confirmed' | 'Declined'; displayConfirmed?: boolean },
    ) =>
      unwrap(
        http.POST('/v1/seller/viewing-tasks/{id}/respond', { params: { path: { id } }, body: b }),
      ),
    respondPurchase: (taskId: string, response: 'Confirmed' | 'Declined') =>
      unwrap(
        http.POST('/v1/seller/purchase-tasks/{taskId}/respond', {
          params: { path: { taskId } },
          body: { response },
        }),
      ),

    /* ---- check-in ---- */
    scan: (token: string) => unwrap(http.POST('/v1/seller/viewings/scan', { body: { token } })),
    outcome: (viewingId: string, outcome: 'Completed' | 'No-show') =>
      unwrap(
        http.POST('/v1/seller/viewings/{id}/outcome', {
          params: { path: { id: viewingId } },
          body: { outcome },
        }),
      ),

    /* ---- orders ---- */
    lines: (q: { state?: LineState; cursor?: string; limit?: number } = {}) =>
      unwrap(http.GET('/v1/seller/order-lines', { params: { query: q } })),
    advance: (id: string, b: { to: AdvanceTo; proofPhotoKey?: string; reason?: string }) =>
      unwrap(
        http.POST('/v1/seller/order-lines/{id}/advance', { params: { path: { id } }, body: b }),
      ),
    proofUpload: (lineId: string, contentType: ProofType, sizeBytes: number) =>
      unwrap(
        http.POST('/v1/seller/order-lines/{id}/proof-upload', {
          params: { path: { id: lineId } },
          body: { contentType, sizeBytes },
        }),
      ),
    issues: (q: { state?: IssueState; cursor?: string; limit?: number } = {}) =>
      unwrap(http.GET('/v1/seller/issues', { params: { query: q } })),
    respondIssue: (id: string, b: { note: string; action: 'PartnerHandling' | 'Resolved' }) =>
      unwrap(http.POST('/v1/seller/issues/{id}/respond', { params: { path: { id } }, body: b })),

    /* ---- stock ---- */
    offers: (q: { q?: string; cursor?: string; limit?: number } = {}) =>
      unwrap(http.GET('/v1/seller/offers', { params: { query: q } })),
    patchOffer: (id: string, body: OfferPatch) =>
      unwrap(http.PATCH('/v1/seller/offers/{id}', { params: { path: { id } }, body })),

    /* ---- device ---- */
    registerDevice: (b: {
      platform: 'ios' | 'android' | 'web';
      pushToken: string;
      appVersion?: string;
    }) => unwrap(http.PUT('/v1/me/devices', { body: b })),
  };
}

export type SellerData = ReturnType<typeof createSellerData>;

export type LineState =
  | 'Confirmed'
  | 'Preparing'
  | 'Ready for Dispatch'
  | 'Dispatched'
  | 'Delivered'
  | 'Receipt Confirmed'
  | 'Cancelled'
  | 'Refunded';
export type AdvanceTo =
  'Preparing' | 'Ready for Dispatch' | 'Dispatched' | 'Delivered' | 'Cancelled';
export type IssueState = 'Open' | 'Partner Handling' | 'Resolved' | 'Refunded' | 'Rejected';
export type ProofType = 'image/jpeg' | 'image/png' | 'image/webp';

/** Put a photo to the signed URL the API issued. The bytes never pass through our API. */
export async function putProof(
  upload: { uploadUrl: string; headers: Record<string, unknown> },
  body: Blob,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(upload.headers)) headers[k] = String(v);
  const res = await fetchImpl(upload.uploadUrl, { method: 'PUT', headers, body });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}

/** The next legal step for a line, and whether it needs proof of delivery. Mirrors the server's machine. */
export function nextStep(state: LineState): { to: AdvanceTo; needsProof: boolean } | null {
  switch (state) {
    case 'Confirmed':
      return { to: 'Preparing', needsProof: false };
    case 'Preparing':
      return { to: 'Ready for Dispatch', needsProof: false };
    case 'Ready for Dispatch':
      return { to: 'Dispatched', needsProof: false };
    case 'Dispatched':
      return { to: 'Delivered', needsProof: true };
    default:
      return null;
  }
}

/** A seller can cancel before the goods leave. */
export const canCancel = (state: LineState): boolean =>
  state === 'Confirmed' || state === 'Preparing' || state === 'Ready for Dispatch';
