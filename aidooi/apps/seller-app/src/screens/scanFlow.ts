import { useCallback, useRef, useState } from 'react';
import { ApiProblem } from '@aidooi/api-client';
import type { SellerData } from '../data/seller.ts';
import {
  interpretScan,
  interpretScanProblem,
  normalisePass,
  type ScanView,
} from '../domain/scan.ts';

export type ScanState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'busy' }
  | {
      readonly phase: 'shown';
      readonly view: ScanView;
      readonly outcome: 'Completed' | 'No-show' | null;
    };

/** Same code seen again within this window is the camera re-reading one QR, not a second visitor. */
export const REPEAT_WINDOW_MS = 3_000;

/**
 * The check-in flow as a hook: scan or type a code, show what the server says, then record the visit's
 * outcome. Scanning is idempotent on the server, so a repeated read is harmless; the debounce only stops
 * the camera hammering the API while the same QR sits in front of it.
 */
export function useScanFlow(
  data: Pick<SellerData, 'scan' | 'outcome'>,
  clock: () => number = Date.now,
) {
  const [state, setState] = useState<ScanState>({ phase: 'idle' });
  const last = useRef<{ code: string; at: number } | null>(null);
  const busy = useRef(false);

  const submit = useCallback(
    async (raw: string) => {
      const code = normalisePass(raw);
      if (code.length < 10 || busy.current) return;
      const at = clock();
      if (last.current && last.current.code === code && at - last.current.at < REPEAT_WINDOW_MS)
        return;
      last.current = { code, at };
      busy.current = true;
      setState({ phase: 'busy' });
      try {
        const result = await data.scan(code);
        setState({ phase: 'shown', view: interpretScan(result, at), outcome: null });
      } catch (e) {
        const view =
          e instanceof ApiProblem
            ? interpretScanProblem(e.code)
            : ({ kind: 'error', code: 'network' } as const);
        setState({ phase: 'shown', view, outcome: null });
      } finally {
        busy.current = false;
      }
    },
    [data, clock],
  );

  const record = useCallback(
    async (outcome: 'Completed' | 'No-show') => {
      if (state.phase !== 'shown') return;
      const v = state.view;
      if (v.kind !== 'checked_in' && v.kind !== 'already') return;
      await data.outcome(v.result.viewingRequestId, outcome);
      setState({ phase: 'shown', view: v, outcome });
    },
    [data, state],
  );

  const reset = useCallback(() => {
    last.current = null;
    setState({ phase: 'idle' });
  }, []);

  return { state, submit, record, reset };
}
