import { hash, verify, type Algorithm } from '@node-rs/argon2';

// OWASP's argon2id minimum (19 MiB, t=2, p=1). Raise with hardware; stored hashes carry their own parameters.
const PARAMS = { algorithm: 2 as Algorithm, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password: string): Promise<string> => hash(password, PARAMS);

let dummy: Promise<string> | undefined;

/**
 * Verify against `stored`, or — when there is no such user — against a throwaway hash, so an
 * unknown account costs the same time as a wrong password.
 */
export async function verifyPassword(stored: string | null, password: string): Promise<boolean> {
  const target = stored ?? (await (dummy ??= hashPassword('not-a-real-password')));
  try {
    const ok = await verify(target, password);
    return ok && stored !== null;
  } catch {
    return false;
  }
}

/** Length is what matters (NIST SP 800-63B); no composition rules. */
export const passwordProblem = (p: string): string | null =>
  p.length < 12 ? 'Use at least 12 characters.' : p.length > 256 ? 'Too long.' : null;
