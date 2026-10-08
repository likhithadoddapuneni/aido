/** A business rule was violated. Carries a stable `code` for clients and tests. */
export class RuleViolation extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RuleViolation';
    this.code = code;
  }
}

export class IllegalTransition extends RuleViolation {
  constructor(machine: string, from: string, to: string) {
    super('illegal_transition', `${machine}: ${from} → ${to} is not allowed`);
    this.name = 'IllegalTransition';
  }
}

export type Result<T, E = RuleViolation> = { ok: true; value: T } | { ok: false; error: E };
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
