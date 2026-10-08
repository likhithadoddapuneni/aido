import type { KeyValueStore } from '../../storage/index.ts';
import type { Pass, Viewing } from './services.ts';

const key = (id: string) => `aidooi.pass.v1.${id}`;

/** What the pass screen needs, small enough for the keychain: the token and where/when to show it. */
export interface CachedPass {
  readonly viewingId: string;
  readonly token: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly scheduledAt: string | null;
  readonly stops: readonly {
    stopNo: number;
    partnerName: string;
    locationName: string;
    address: string;
  }[];
  readonly cachedAt: string;
}

export const toCached = (viewing: Viewing, pass: Pass, nowIso: string): CachedPass => ({
  viewingId: viewing.id,
  token: pass.token,
  validFrom: pass.validFrom,
  validUntil: pass.validUntil,
  scheduledAt: viewing.scheduledAt,
  stops: viewing.stops.map((s) => ({
    stopNo: s.stopNo,
    partnerName: s.partnerName,
    locationName: s.locationName,
    address: s.address,
  })),
  cachedAt: nowIso,
});

export function createPassCache(kv: KeyValueStore) {
  return {
    async save(p: CachedPass): Promise<void> {
      await kv.set(key(p.viewingId), JSON.stringify(p));
    },
    async read(viewingId: string): Promise<CachedPass | null> {
      const raw = await kv.get(key(viewingId));
      if (!raw) return null;
      try {
        const p = JSON.parse(raw) as Partial<CachedPass>;
        return typeof p.token === 'string' && typeof p.validUntil === 'string'
          ? (p as CachedPass)
          : null;
      } catch {
        return null;
      }
    },
    async remove(viewingId: string): Promise<void> {
      await kv.remove(key(viewingId));
    },
  };
}
export type PassCache = ReturnType<typeof createPassCache>;
