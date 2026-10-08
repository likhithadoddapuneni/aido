import { ConfirmDialog, Field, Textarea } from '@aidooi/ui-web';
import { useState, type ReactNode } from 'react';
import { useCopy } from '../lib/i18n.ts';

/** The contract's reason rule: 3–500 characters once trimmed. Mirrored so Confirm stays off until it holds. */
export const REASON_MIN = 3;
export const REASON_MAX = 500;

/**
 * A confirmation that also collects the reason for the audit trail. Confirm is disabled until the reason is
 * long enough; a failed request keeps the dialog open with the translated problem (see `ConfirmDialog`).
 */
export function ReasonConfirm({
  open,
  title,
  description,
  confirmLabel,
  danger,
  requireWord,
  extra,
  extraReady = true,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  danger?: boolean | undefined;
  requireWord?: string | undefined;
  /** More inputs shown above the reason (for example the "force" box). */
  extra?: ReactNode;
  extraReady?: boolean;
  onConfirm: (reason: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const copy = useCopy();
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();
  const close = () => {
    setReason('');
    onClose();
  };
  return (
    <ConfirmDialog
      open={open}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      danger={danger}
      requireWord={requireWord}
      disabled={trimmed.length < REASON_MIN || !extraReady}
      onConfirm={async () => {
        await onConfirm(trimmed);
        setReason('');
      }}
      onClose={close}
    >
      {extra}
      <Field label={copy.t('reason')} hint={copy.t('reasonHint')} required>
        <Textarea
          value={reason}
          maxLength={REASON_MAX}
          rows={3}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
    </ConfirmDialog>
  );
}
