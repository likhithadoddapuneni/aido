/** One field-level validation error from the API (`ApiProblem.fieldErrors`). */
export interface FieldError {
  readonly path: string;
  readonly message: string;
}
