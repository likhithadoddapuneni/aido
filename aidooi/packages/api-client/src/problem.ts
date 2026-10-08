/** A non-2xx answer from the API (RFC 9457). Screens switch on `code`, never on message text. */
export class ApiProblem extends Error {
  readonly status: number;
  readonly code: string;
  readonly correlationId: string | null;
  readonly fieldErrors: readonly { path: string; message: string }[];

  constructor(init: {
    status: number;
    code: string;
    detail?: string;
    correlationId?: string | null;
    errors?: readonly { path: string; message: string }[];
  }) {
    super(init.detail ?? init.code);
    this.name = 'ApiProblem';
    this.status = init.status;
    this.code = init.code;
    this.correlationId = init.correlationId ?? null;
    this.fieldErrors = init.errors ?? [];
  }

  /** Worth retrying with the same idempotency key: the server could not take the request, or is mid-way through it. */
  get retryable(): boolean {
    return (
      this.status === 503 ||
      this.status === 502 ||
      this.status === 504 ||
      this.code === 'request_in_progress'
    );
  }
}

/** The request never produced a response (offline, DNS, TLS, timeout). The outcome is unknown. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Network request failed');
    this.name = 'NetworkError';
  }
}

interface ProblemBody {
  readonly status?: number;
  readonly code?: string;
  readonly detail?: string;
  readonly correlationId?: string;
  readonly errors?: readonly { path: string; message: string }[];
}

export function problemFromBody(
  status: number,
  body: unknown,
  correlationHeader: string | null,
): ApiProblem {
  const b = (body && typeof body === 'object' ? body : {}) as ProblemBody;
  return new ApiProblem({
    status,
    code: b.code ?? (status >= 500 ? 'internal_error' : 'unknown_error'),
    ...(b.detail ? { detail: b.detail } : {}),
    correlationId: b.correlationId ?? correlationHeader,
    ...(b.errors ? { errors: b.errors } : {}),
  });
}

export async function problemFrom(res: Response): Promise<ApiProblem> {
  let body: unknown = {};
  try {
    body = await res.clone().json();
  } catch {
    /* an upstream proxy answered with HTML or nothing */
  }
  return problemFromBody(res.status, body, res.headers.get('x-correlation-id'));
}

/** Turn an openapi-fetch result into its data, or throw the problem. */
export async function unwrap<T>(
  result: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const r = await result;
  if (r.response.ok) return r.data as T;
  // openapi-fetch has already read the body into `error`; the response can no longer be re-read.
  throw r.error === undefined
    ? await problemFrom(r.response)
    : problemFromBody(r.response.status, r.error, r.response.headers.get('x-correlation-id'));
}
