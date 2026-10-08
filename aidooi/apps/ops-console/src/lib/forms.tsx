import { ApiProblem } from '@aidooi/api-client';
import { FormErrorSummary, useProblemText, type FieldError } from '@aidooi/ui-web';
import { useMemo, useState } from 'react';
import {
  set,
  useForm,
  type FieldValues,
  type Resolver,
  type UseFormProps,
  type UseFormReturn,
} from 'react-hook-form';
import { z } from 'zod';
import { useCopy, type Copy } from './i18n.ts';

/** `''` (an untouched text box) means "nothing": the contract says `null`. */
export const blankToNull = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), schema);

/** An optional text field that the API wants as `null` when empty. */
export const optionalText = <T extends z.ZodType>(schema: T) => blankToNull(z.nullable(schema));

export interface ApiForm<I extends FieldValues, O> extends UseFormReturn<I, unknown, O> {
  /** Problems the API returned for fields, shown as a summary plus on each field. */
  readonly serverErrors: readonly FieldError[];
  readonly setServerError: (e: unknown) => void;
  readonly clearServerError: () => void;
  readonly serverProblem: unknown;
  /** The message to show under a field: client validation first, then the server's. */
  readonly messageFor: (name: string) => string | undefined;
}

/**
 * react-hook-form wired to a contract's Zod schema, with validation messages in the user's language and
 * the API's own field errors folded back onto the same inputs. `fieldMap` renames API paths to form names
 * (for example `commissionBps` → `commissionPct`).
 */
export function useApiForm<S extends z.ZodType>(
  schema: S,
  defaults: z.input<S>,
  opts: { fieldMap?: Record<string, string>; mode?: UseFormProps['mode'] } = {},
): ApiForm<z.input<S> & FieldValues, z.output<S>> {
  const copy = useCopy();
  // Our own resolver rather than a library's: contract schemas carry English messages ("Use YYYY-MM"),
  // and a schema's own message beats any contextual `error` map. We keep the failing rule, not the words.
  const resolver = useMemo<Resolver<z.input<S> & FieldValues, unknown, z.output<S>>>(
    () => async (values) => {
      const parsed = await schema.safeParseAsync(values);
      if (parsed.success) return { values: parsed.data as z.output<S>, errors: {} };
      const errors: Record<string, unknown> = {};
      for (const iss of parsed.error.issues) {
        const name = iss.path.join('.');
        if (name in errors) continue;
        const raw = iss as unknown as Record<string, unknown>;
        set(errors, name, {
          type: iss.code,
          message: copy.issue({
            code: iss.code,
            message: iss.message,
            format: raw['format'] as string | undefined,
            origin: raw['origin'] as string | undefined,
            minimum: raw['minimum'] as number | bigint | undefined,
            pattern: raw['pattern'] as string | undefined,
          }),
        });
      }
      return { values: {}, errors } as never;
    },
    [schema, copy],
  );
  const form = useForm<z.input<S> & FieldValues, unknown, z.output<S>>({
    resolver,
    defaultValues: defaults as never,
    mode: opts.mode ?? 'onSubmit',
  });
  const [problem, setProblem] = useState<unknown>(null);
  const [serverErrors, setServerErrors] = useState<FieldError[]>([]);

  const setServerError = (e: unknown) => {
    setProblem(e);
    const fields =
      e instanceof ApiProblem
        ? e.fieldErrors.map((f) => ({
            path: opts.fieldMap?.[f.path] ?? f.path,
            message: f.message,
          }))
        : [];
    setServerErrors(fields);
  };
  const serverByName = new Map(serverErrors.map((f) => [f.path, f.message]));

  return Object.assign(form, {
    serverErrors,
    serverProblem: problem,
    setServerError,
    clearServerError: () => {
      setProblem(null);
      setServerErrors([]);
    },
    messageFor: (name: string) => {
      const err = (form.formState.errors as Record<string, { message?: unknown } | undefined>)[
        name
      ];
      return typeof err?.message === 'string' ? err.message : serverByName.get(name);
    },
  });
}

/**
 * What to show above a form after a failed submit: the field list when the API pointed at fields, or one
 * plain sentence for anything else. Never a raw code.
 */
export function FormProblem({
  form,
}: {
  form: Pick<ApiForm<FieldValues, unknown>, 'serverErrors' | 'serverProblem'>;
}) {
  const text = useProblemText();
  if (form.serverProblem === null) return null;
  if (form.serverErrors.length > 0) return <FormErrorSummary errors={form.serverErrors} />;
  return (
    <p role="alert" className="ui-field__error">
      {text(form.serverProblem)}
    </p>
  );
}

export type { Copy };
