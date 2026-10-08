import { unwrap } from '@aidooi/api-client';
import { Button, useApi, useApiMutation, useProblemText, useToast } from '@aidooi/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { useS } from '../i18n/index.tsx';
import { checkImage, isImageType, putToStorage } from '../lib/upload.ts';

/** Add one product photograph: sign → upload straight to storage → confirm. */
export function PhotoUpload({
  productId,
  taken,
  altText,
}: {
  productId: string;
  /** Positions already used, so the new photo takes the first free slot. */
  taken: readonly number[];
  altText: string;
}) {
  const s = useS();
  const api = useApi();
  const toast = useToast();
  const queries = useQueryClient();
  const problemText = useProblemText();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [rejected, setRejected] = useState<string | null>(null);

  const upload = useApiMutation(
    async (file: File) => {
      const signed = await unwrap(
        api.http.POST('/v1/seller/products/{id}/media', {
          params: { path: { id: productId } },
          body: { contentType: file.type as never, sizeBytes: file.size },
        }),
      );
      await putToStorage(file, signed);
      let position = 0;
      while (taken.includes(position)) position++;
      return unwrap(
        api.http.POST('/v1/seller/products/{id}/media/confirm', {
          params: { path: { id: productId } },
          body: { storageKey: signed.storageKey, position, altText, widthPx: null, heightPx: null },
        }),
      );
    },
    {
      onSuccess: async () => {
        toast.push({ message: s.photoAdded, tone: 'ok' });
        await queries.invalidateQueries({ queryKey: ['products'] });
      },
    },
  );

  return (
    <div>
      <label htmlFor={id} className="ui-field__label">
        {s.addPhoto}
      </label>
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          const problem = isImageType(f.type) ? checkImage(f) : 'wrong_type';
          if (problem)
            return setRejected(problem === 'too_large' ? s.photoTooLarge : s.photoWrongType);
          setRejected(null);
          upload.mutate(f);
        }}
      />
      {upload.isPending && <p role="status">{s.uploading}</p>}
      {(rejected || upload.error) && (
        <p role="alert" className="portal-error">
          {rejected ?? problemText(upload.error)}
        </p>
      )}
      {upload.error && <Button onClick={() => upload.reset()}>{s.dismiss}</Button>}
    </div>
  );
}
