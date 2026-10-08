import { ApiProblem } from '@aidooi/api-client';

export interface SignedUpload {
  readonly uploadUrl: string;
  readonly method: 'PUT';
  readonly headers: Record<string, string>;
}

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
export const MAX_IMAGE_BYTES = 10_000_000;

export const isImageType = (t: string): t is ImageType =>
  (IMAGE_TYPES as readonly string[]).includes(t);

/** Why a chosen file cannot be uploaded, before any request is made. */
export function checkImage(file: {
  type: string;
  size: number;
}): 'wrong_type' | 'too_large' | null {
  if (!isImageType(file.type)) return 'wrong_type';
  if (file.size > MAX_IMAGE_BYTES) return 'too_large';
  return null;
}

/**
 * Send the bytes straight to storage with the signed URL. Image bytes never pass through our API;
 * the API only confirms afterwards that the object arrived.
 */
export async function putToStorage(file: File, signed: SignedUpload): Promise<void> {
  const res = await fetch(signed.uploadUrl, {
    method: signed.method,
    headers: signed.headers,
    body: file,
  });
  if (!res.ok) throw new ApiProblem({ status: 502, code: 'upload_not_found' });
}
