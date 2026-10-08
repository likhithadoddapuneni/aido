import { useId, useState, type ReactNode } from 'react';
import { useT } from '../locale.tsx';
import { Button } from './Button.tsx';
import { Field } from './Field.tsx';
import { Input } from './controls.tsx';
import { Dialog } from './Overlay.tsx';
import { useProblemText } from './states.tsx';

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  danger?: boolean | undefined;
  /** For irreversible actions: the user must type this exact word before Confirm enables. */
  requireWord?: string | undefined;
  /** Extra content under the description, such as a field that collects the reason for the action. */
  children?: ReactNode;
  /** An extra gate on Confirm (for example, the reason is still empty). Does not replace `requireWord`. */
  disabled?: boolean | undefined;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger = false,
  requireWord,
  children,
  disabled = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const t = useT();
  const descId = useId();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const problemText = useProblemText();
  const ready = (!requireWord || typed === requireWord) && !disabled;

  const close = () => {
    setTyped('');
    setFailure(null);
    onClose();
  };
  const confirm = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await onConfirm();
      close();
    } catch (e) {
      // Stay open and say why: a failed approval must never look like a successful one.
      setFailure(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      describedById={descId}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t.cancel}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={!ready}
            loading={busy}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p id={descId}>{description}</p>
      {children}
      {failure !== null && (
        <p role="alert" className="ui-field__error">
          {problemText(failure)}
        </p>
      )}
      {requireWord && (
        <Field label={t.fmt('typeToConfirm', { word: requireWord })}>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            data-autofocus
          />
        </Field>
      )}
    </Dialog>
  );
}
