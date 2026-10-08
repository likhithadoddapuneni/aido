import { ApiProblem } from '@aidooi/api-client';
import type { FieldError } from '@aidooi/ui-web';

/** Field-level errors from a 400, in the shape the shared error summary wants. */
export const fieldErrorsOf = (error: unknown): FieldError[] =>
  error instanceof ApiProblem
    ? error.fieldErrors.map((e) => ({ path: e.path, message: e.message }))
    : [];

export const messageFor = (errors: readonly FieldError[], path: string): string | undefined =>
  errors.find((e) => e.path === path)?.message;

export const isProblem = (error: unknown, code: string): error is ApiProblem =>
  error instanceof ApiProblem && error.code === code;
