import type { KeyValueStore } from '../storage/index.ts';

const KEY = 'aidooi.pending-action.v1';

/** Where to go after signing in. Only in-app routes are ever stored. */
export interface PendingAction {
  readonly href: string;
}

const isInApp = (href: string): boolean => href.startsWith('/') && !href.startsWith('//');

/**
 * A guest who reaches a step that needs an account is sent to sign in; the step they wanted is
 * remembered here so signing in lands them back on it with nothing lost (gap #13). The guest's
 * projects follow them: the server re-owns them when the session is upgraded.
 */
export function createPendingActions(kv: KeyValueStore) {
  return {
    async save(href: string): Promise<void> {
      if (isInApp(href)) await kv.set(KEY, JSON.stringify({ href } satisfies PendingAction));
    },
    /** Reads and clears in one step: a pending action is used once. */
    async consume(): Promise<string | null> {
      const raw = await kv.get(KEY);
      await kv.remove(KEY);
      if (!raw) return null;
      try {
        const v = JSON.parse(raw) as Partial<PendingAction>;
        return typeof v.href === 'string' && isInApp(v.href) ? v.href : null;
      } catch {
        return null;
      }
    },
    async peek(): Promise<string | null> {
      const raw = await kv.get(KEY);
      try {
        const v = raw ? (JSON.parse(raw) as Partial<PendingAction>) : null;
        return typeof v?.href === 'string' && isInApp(v.href) ? v.href : null;
      } catch {
        return null;
      }
    },
  };
}

export type PendingActions = ReturnType<typeof createPendingActions>;
