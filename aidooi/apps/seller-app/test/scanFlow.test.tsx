/* eslint-disable no-restricted-globals -- tests pin instants with Date */
import { act, renderHook } from '@testing-library/react-native';
import { ApiProblem } from '@aidooi/api-client';
import { REPEAT_WINDOW_MS, useScanFlow } from '../src/screens/scanFlow.ts';

const CODE = 'pass.abcdefghijklmnop.signature';
const result = (checkedInAt: string) => ({
  viewingRequestId: 'vr1',
  stopId: 's1',
  scheduledAt: checkedInAt,
  buyerName: 'Sara',
  products: [{ name: 'Sofa', quantity: 1 }],
  checkedInAt,
});
const T0 = Date.parse('2026-10-07T10:00:00Z');

async function setup(scan: jest.Mock, clock = () => T0) {
  const outcome = jest.fn(async () => undefined);
  const hook = await renderHook(() => useScanFlow({ scan, outcome } as never, clock));
  return { hook, outcome };
}

describe('useScanFlow', () => {
  it('shows a fresh check-in', async () => {
    const scan = jest.fn(async () => result(new Date(T0).toISOString()));
    const { hook } = await setup(scan);
    expect(hook.result.current.state.phase).toBe('idle');
    await act(async () => hook.result.current.submit(CODE));
    expect(hook.result.current.state).toMatchObject({
      phase: 'shown',
      view: { kind: 'checked_in' },
    });
  });

  it('reassures on an already-checked-in visitor', async () => {
    const scan = jest.fn(async () => result(new Date(T0 - 600_000).toISOString()));
    const { hook } = await setup(scan);
    await act(async () => hook.result.current.submit(CODE));
    expect(hook.result.current.state).toMatchObject({ view: { kind: 'already' } });
  });

  it.each([
    ['pass_invalid', 'invalid'],
    ['pass_expired', 'expired'],
    ['pass_not_yet_valid', 'not_yet'],
    ['not_found', 'not_ours'],
    ['viewing_not_active', 'closed'],
  ] as [string, string][])('maps %s to %s', async (code: string, kind: string) => {
    const scan = jest.fn(async () => {
      throw new ApiProblem({ status: 400, code });
    });
    const { hook } = await setup(scan);
    await act(async () => hook.result.current.submit(CODE));
    expect(hook.result.current.state).toMatchObject({ view: { kind } });
  });

  it('reports a non-API failure as a generic error', async () => {
    const { hook } = await setup(jest.fn(async () => Promise.reject(new TypeError('x'))));
    await act(async () => hook.result.current.submit(CODE));
    expect(hook.result.current.state).toMatchObject({ view: { kind: 'error' } });
  });

  it('ignores too-short codes and debounces the same code', async () => {
    let now = T0;
    const scan = jest.fn(async () => result(new Date(T0).toISOString()));
    const { hook } = await setup(scan, () => now);
    await act(async () => hook.result.current.submit('short'));
    expect(scan).not.toHaveBeenCalled();
    await act(async () => hook.result.current.submit(CODE));
    await act(async () => hook.result.current.submit(CODE));
    expect(scan).toHaveBeenCalledTimes(1);
    now += REPEAT_WINDOW_MS + 1;
    await act(async () => hook.result.current.submit(CODE));
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('ignores a scan while one is in flight', async () => {
    let release!: (r: ReturnType<typeof result>) => void;
    const scan = jest.fn(() => new Promise<ReturnType<typeof result>>((r) => (release = r)));
    const { hook } = await setup(scan as never);
    let first!: Promise<void>;
    await act(async () => {
      first = hook.result.current.submit(CODE);
    });
    await act(async () => hook.result.current.submit(CODE + 'x'));
    expect(scan).toHaveBeenCalledTimes(1);
    await act(async () => {
      release(result(new Date(T0).toISOString()));
      await first;
    });
  });

  it('records the visit outcome only for a checked-in visitor', async () => {
    const scan = jest.fn(async () => result(new Date(T0).toISOString()));
    const { hook, outcome } = await setup(scan);
    await act(async () => hook.result.current.record('Completed'));
    expect(outcome).not.toHaveBeenCalled();
    await act(async () => hook.result.current.submit(CODE));
    await act(async () => hook.result.current.record('No-show'));
    expect(outcome).toHaveBeenCalledWith('vr1', 'No-show');
    expect(hook.result.current.state).toMatchObject({ outcome: 'No-show' });
    await act(async () => hook.result.current.reset());
    expect(hook.result.current.state.phase).toBe('idle');
  });
});
