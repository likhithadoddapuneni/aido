import { toNestErrors } from '@hookform/resolvers';
import type { FieldError } from '@aidooi/ui-web';
import type { FieldErrors, FieldValues, Resolver } from 'react-hook-form';
import type { z } from 'zod';
import type { Strings } from '../i18n/index.tsx';

/** Localised wording for client-side validation; zod's own messages are English only. */
function issueText(issue: z.core.$ZodIssue, s: Strings): string {
  switch (issue.code) {
    case 'too_small':
      return issue.origin === 'string' ? s.vTooShort : s.vTooSmall;
    case 'too_big':
      return issue.origin === 'string' ? s.vTooLong : s.vTooBig;
    case 'invalid_format':
    case 'invalid_value':
      return s.vInvalid;
    case 'invalid_type':
      return s.vRequired;
    default:
      return issue.message && !/^Invalid/.test(issue.message) ? issue.message : s.vInvalid;
  }
}

/**
 * react-hook-form resolver over a contract Zod schema — the same validators the server runs — with
 * messages in the user's language. Server-side rules the schema cannot express arrive later as field errors.
 */
export function resolverFor<TIn extends FieldValues>(schema: z.ZodType, s: Strings): Resolver<TIn> {
  return async (values, _ctx, options) => {
    const result = schema.safeParse(values);
    if (result.success) return { values: result.data as TIn, errors: {} };
    const flat: Record<string, { type: string; message: string }> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      flat[path] ??= { type: issue.code, message: issueText(issue, s) };
    }
    return {
      values: {},
      errors: toNestErrors(flat, options) as FieldErrors<TIn>,
    };
  };
}

/** Parse "12.50" typed in dirhams into integer fils, or null. Never uses floats for the stored value. */
export function dirhamsToFils(input: string): number | null {
  const m = /^\s*(\d{1,9})(?:[.,](\d{1,2}))?\s*$/.exec(input);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? '').padEnd(2, '0'));
  return whole * 100 + frac;
}

export const filsToDirhams = (fils: number): string => {
  const whole = Math.floor(fils / 100);
  const frac = fils % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0')}`;
};

/** Spread server field errors over a form so each shows beside its control. */
export function serverErrorsByPath(errors: readonly FieldError[]): Record<string, string> {
  return Object.fromEntries(errors.map((e) => [e.path, e.message]));
}

/** Validate a request body against its contract schema, with localised messages keyed by field path. */
export function validateBody(
  schema: z.ZodType,
  body: unknown,
  s: Strings,
): { ok: true; data: unknown } | { ok: false; errors: Record<string, string> } {
  const r = schema.safeParse(body);
  if (r.success) return { ok: true, data: r.data };
  const errors: Record<string, string> = {};
  for (const issue of r.error.issues)
    errors[issue.path.join('.') || 'form'] ??= issueText(issue, s);
  return { ok: false, errors };
}
