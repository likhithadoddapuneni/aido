import type { Problem } from '@aidooi/contracts';
import { RuleViolation } from '@aidooi/domain';

/** An error the API chose to expose. Anything else becomes an opaque 500. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly errors: Problem['errors'];
  constructor(status: number, code: string, message: string, errors?: Problem['errors']) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} was not found`);
export const unauthorized = (msg = 'Authentication is required') =>
  new HttpError(401, 'unauthorized', msg);
export const forbidden = (msg = 'You do not have access to this resource') =>
  new HttpError(403, 'forbidden', msg);
export const conflict = (code: string, msg: string) => new HttpError(409, code, msg);

const TITLES: Record<number, string> = {
  400: 'Invalid request',
  401: 'Unauthorized',
  402: 'Payment required',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  422: 'Business rule violated',
  426: 'Upgrade required',
  429: 'Too many requests',
  500: 'Internal error',
  503: 'Service unavailable',
};

export function toProblem(
  status: number,
  code: string,
  detail: string | undefined,
  correlationId: string,
  errors?: Problem['errors'],
): Problem {
  return {
    type: `https://docs.aidooi.example/problems/${code}`,
    title: TITLES[status] ?? 'Error',
    status,
    code,
    ...(detail ? { detail } : {}),
    correlationId,
    ...(errors?.length ? { errors } : {}),
  };
}

/** Business-rule violations are the caller's problem (422), not ours (500). */
export const isRuleViolation = (e: unknown): e is RuleViolation => e instanceof RuleViolation;
