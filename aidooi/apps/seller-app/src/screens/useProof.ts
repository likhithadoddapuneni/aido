import { useCallback, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { putProof, type ProofType, type SellerData } from '../data/seller.ts';

export type ProofState =
  | { readonly phase: 'none' }
  | { readonly phase: 'uploading' }
  | { readonly phase: 'ready'; readonly key: string; readonly uri: string }
  | { readonly phase: 'failed' }
  | { readonly phase: 'denied' };

const TYPES: Record<string, ProofType> = {
  'image/jpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
};
export const proofType = (mime: string | null | undefined): ProofType =>
  TYPES[mime ?? ''] ?? 'image/jpeg';

/**
 * Take a photo of the delivery and put it in storage: the API issues a short-lived signed URL, the app
 * uploads straight to it. The returned key is what `advance` needs to mark an item delivered.
 */
export function useProof(
  lineId: string,
  data: Pick<SellerData, 'proofUpload'>,
  deps: {
    picker?: Pick<typeof ImagePicker, 'requestCameraPermissionsAsync' | 'launchCameraAsync'>;
    fetch?: typeof fetch;
  } = {},
) {
  const picker = deps.picker ?? ImagePicker;
  const [state, setState] = useState<ProofState>({ phase: 'none' });

  const capture = useCallback(async () => {
    const perm = await picker.requestCameraPermissionsAsync();
    if (!perm.granted) return setState({ phase: 'denied' });
    const shot = await picker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 });
    const asset = shot.canceled ? null : shot.assets[0];
    if (!asset) return;
    setState({ phase: 'uploading' });
    try {
      const f = deps.fetch ?? fetch;
      const blob = await (await f(asset.uri)).blob();
      const type = proofType(asset.mimeType ?? blob.type);
      const upload = await data.proofUpload(lineId, type, Math.max(1, blob.size));
      await putProof(upload, blob, deps.fetch);
      setState({ phase: 'ready', key: upload.storageKey, uri: asset.uri });
    } catch {
      setState({ phase: 'failed' });
    }
  }, [data, lineId, picker, deps.fetch]);

  return { state, capture };
}
