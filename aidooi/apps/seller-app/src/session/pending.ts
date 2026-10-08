/**
 * Credentials held in memory between "accept invitation" / "MFA required" and "finish setup", so the
 * password is never written to a route, storage or a log. Cleared the moment sign-in completes.
 */
let pending: { email: string; password: string } | null = null;

export const setPending = (c: { email: string; password: string }): void => {
  pending = c;
};
export const takePending = (): { email: string; password: string } | null => pending;
export const clearPending = (): void => {
  pending = null;
};
