import { useId, useRef, useState, type DragEvent } from 'react';
import { cx } from '../cx.ts';
import { useT } from '../locale.tsx';
import { Button } from './Button.tsx';

export type CsvRejection = 'too_large' | 'wrong_type';

/** The guard, separated so it is testable without a DOM: type by extension or MIME, size in bytes. */
export function checkCsv(
  file: { name: string; type: string; size: number },
  maxBytes: number,
): CsvRejection | null {
  const csv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
  if (!csv) return 'wrong_type';
  if (file.size > maxBytes) return 'too_large';
  return null;
}

const mb = (n: number) => `${Math.round((n / 1_048_576) * 10) / 10} MB`;

export function CsvDropzone({
  maxBytes,
  onFile,
}: {
  maxBytes: number;
  onFile: (file: File | null) => void;
}) {
  const t = useT();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accept = (f: File | undefined) => {
    if (!f) return;
    const rejection = checkCsv(f, maxBytes);
    if (rejection) {
      setError(
        rejection === 'too_large' ? t.fmt('fileTooLarge', { max: mb(maxBytes) }) : t.fileWrongType,
      );
      return;
    }
    setError(null);
    setFile(f);
    onFile(f);
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    accept(e.dataTransfer.files[0]);
  };

  return (
    <div>
      <div
        className={cx('ui-drop', over && 'is-over')}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <label htmlFor={id}>{t.dropCsv}</label>
        <input
          ref={input}
          id={id}
          type="file"
          accept=".csv,text/csv"
          className="ui-visually-hidden"
          onChange={(e) => accept(e.target.files?.[0])}
          aria-describedby={error ? `${id}-err` : undefined}
        />
        <Button onClick={() => input.current?.click()}>{t.chooseFile}</Button>
      </div>
      {error && (
        <p id={`${id}-err`} role="alert" className="ui-field__error">
          {error}
        </p>
      )}
      {file && (
        <p className="ui-drop__file">
          <bdi>{file.name}</bdi>{' '}
          <Button
            variant="ghost"
            onClick={() => {
              setFile(null);
              onFile(null);
              if (input.current) input.current.value = '';
            }}
          >
            {t.removeFile}
          </Button>
        </p>
      )}
    </div>
  );
}
