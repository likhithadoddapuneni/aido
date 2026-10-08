import { unwrap } from '@aidooi/api-client';
import { Button, Dialog, useApi, useApiMutation, useProblemText } from '@aidooi/ui-web';
import { useId, useState } from 'react';
import { useS } from '../i18n/index.tsx';
import { checkImage, isImageType, putToStorage } from '../lib/upload.ts';

/** Mark a line delivered: the photo goes straight to storage, then the line advances with its key. */
export function ProofDialog({
  lineId,
  productName,
  onClose,
  onDelivered,
}: {
  lineId: string | null;
  productName: string;
  onClose: () => void;
  onDelivered: () => void;
}) {
  const s = useS();
  const api = useApi();
  const problemText = useProblemText();
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);

  const deliver = useApiMutation(
    async (f: File) => {
      const signed = await unwrap(
        api.http.POST('/v1/seller/order-lines/{id}/proof-upload', {
          params: { path: { id: lineId as string } },
          body: { contentType: f.type as never, sizeBytes: f.size },
        }),
      );
      await putToStorage(f, signed);
      return unwrap(
        api.http.POST('/v1/seller/order-lines/{id}/advance', {
          params: { path: { id: lineId as string } },
          body: { to: 'Delivered', proofPhotoKey: signed.storageKey },
        }),
      );
    },
    { onSuccess: () => onDelivered() },
  );

  return (
    <Dialog
      open={lineId !== null}
      onClose={onClose}
      title={s.fmt('deliverTitle', { name: productName })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {s.cancel}
          </Button>
          <Button
            variant="primary"
            disabled={!file}
            loading={deliver.isPending}
            onClick={() => file && deliver.mutate(file)}
          >
            {s.markDelivered}
          </Button>
        </>
      }
    >
      <p>{s.proofHelp}</p>
      <label htmlFor={inputId} className="ui-field__label">
        {s.proofPhoto}
      </label>
      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setFile(null);
          if (!f) return;
          const problem = isImageType(f.type) ? checkImage(f) : 'wrong_type';
          if (problem)
            return setRejected(problem === 'too_large' ? s.photoTooLarge : s.photoWrongType);
          setRejected(null);
          setFile(f);
        }}
      />
      {(rejected || deliver.error) && (
        <p role="alert" className="portal-error">
          {rejected ?? problemText(deliver.error)}
        </p>
      )}
    </Dialog>
  );
}
