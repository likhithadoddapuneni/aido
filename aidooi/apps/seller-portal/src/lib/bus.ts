/** A tiny event bus: the API client (created outside React) tells the React tree the session ended. */
export function createSignedOutBus() {
  const listeners = new Set<() => void>();
  return {
    emit: () => listeners.forEach((l) => l()),
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
}
export type SignedOutBus = ReturnType<typeof createSignedOutBus>;
