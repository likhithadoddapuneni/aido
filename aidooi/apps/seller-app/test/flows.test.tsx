/* eslint-disable no-restricted-globals -- tests pin instants with Date */
import { fireEvent, renderHook, screen, waitFor, act } from '@testing-library/react-native';
import { TaskDetailScreen } from '../src/screens/TaskDetailScreen.tsx';
import { LineScreen } from '../src/screens/LineScreen.tsx';
import { useProof } from '../src/screens/useProof.ts';
import { canCancel, nextStep, putProof } from '../src/data/seller.ts';
import { en } from '../src/i18n/strings.ts';
import { renderApp, route } from './support.tsx';

const inFuture = (ms: number) => new Date(Date.now() + ms).toISOString();
const viewingTask = (over: Record<string, unknown> = {}) => ({
  id: 'vt-1',
  viewingRequestId: 'vr-1',
  stopId: 's-1',
  dueAt: inFuture(3_600_000),
  response: null,
  locationName: 'Al Quoz Showroom',
  products: [
    {
      offerId: 'o1',
      productId: 'p1',
      name: 'Oak Table',
      quantity: 1,
      unitPrice: 125_000,
      onDisplay: true,
    },
  ],
  ...over,
});
const tasks = (v: unknown[] = [viewingTask()], p: unknown[] = []) => [
  route('GET', '/v1/seller/viewing-tasks', () => ({ body: v })),
  route('GET', '/v1/seller/purchase-tasks', () => ({ body: { tasks: p } })),
];

describe('TaskDetailScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('confirming a viewing says what it means, then sends displayConfirmed', async () => {
    const h = await renderApp(<TaskDetailScreen id="vt-1" />, {
      routes: [
        ...tasks(),
        route('POST', '/v1/seller/viewing-tasks/vt-1/respond', () => ({ body: {} })),
      ],
    });
    await fireEvent.press(await screen.findByText(en['tasks.confirm']));
    expect(await screen.findByText(en['tasks.viewing.confirm.title'])).toBeTruthy();
    expect(h.calls.some((c) => c.method === 'POST')).toBe(false); // nothing sent before the confirmation
    await fireEvent.press(screen.getByText(en['common.confirm']));
    await waitFor(() => expect(h.calls.some((c) => c.method === 'POST')).toBe(true));
    expect(h.calls.find((c) => c.method === 'POST')?.body).toEqual({
      response: 'Confirmed',
      displayConfirmed: true,
    });
  });

  it('does not claim display when an item is not on display', async () => {
    const h = await renderApp(<TaskDetailScreen id="vt-1" />, {
      routes: [
        ...tasks([
          viewingTask({
            products: [
              {
                offerId: 'o',
                productId: 'p',
                name: 'Rug',
                quantity: 1,
                unitPrice: 1,
                onDisplay: false,
              },
            ],
          }),
        ]),
        route('POST', '/v1/seller/viewing-tasks/vt-1/respond', () => ({ body: {} })),
      ],
    });
    await fireEvent.press(await screen.findByText(en['tasks.confirm']));
    await fireEvent.press(await screen.findByText(en['common.confirm']));
    await waitFor(() => expect(h.calls.some((c) => c.method === 'POST')).toBe(true));
    expect(h.calls.find((c) => c.method === 'POST')?.body).toEqual({
      response: 'Confirmed',
      displayConfirmed: false,
    });
  });

  it('declining sends no display flag', async () => {
    const h = await renderApp(<TaskDetailScreen id="vt-1" />, {
      routes: [
        ...tasks(),
        route('POST', '/v1/seller/viewing-tasks/vt-1/respond', () => ({ body: {} })),
      ],
    });
    await fireEvent.press(await screen.findByText(en['tasks.decline']));
    expect(await screen.findByText(en['tasks.viewing.decline.title'])).toBeTruthy();
    await fireEvent.press(screen.getAllByText(en['tasks.decline']).at(-1)!);
    await waitFor(() => expect(h.calls.some((c) => c.method === 'POST')).toBe(true));
    expect(h.calls.find((c) => c.method === 'POST')?.body).toEqual({ response: 'Declined' });
  });

  it('answers a purchase task through the purchase endpoint', async () => {
    const purchase = {
      id: 'pt-1',
      dueAt: inFuture(3_600_000),
      responded: null,
      lines: [
        {
          offerId: 'o',
          productName: 'Lamp',
          sellerSku: 'L-1',
          quantity: 2,
          unitPrice: 5_000,
          stockQty: 9,
        },
      ],
    };
    const h = await renderApp(<TaskDetailScreen id="pt-1" />, {
      routes: [
        ...tasks([], [purchase]),
        route('POST', '/v1/seller/purchase-tasks/pt-1/respond', () => ({ body: {} })),
      ],
    });
    await fireEvent.press(await screen.findByText(en['tasks.confirm']));
    expect(await screen.findByText(en['tasks.purchase.confirm.title'])).toBeTruthy();
    await fireEvent.press(screen.getByText(en['common.confirm']));
    await waitFor(() => expect(h.calls.some((c) => c.method === 'POST')).toBe(true));
    expect(h.calls.find((c) => c.method === 'POST')?.body).toEqual({ response: 'Confirmed' });
  });

  it('records a no-show only after an explicit second confirmation', async () => {
    const h = await renderApp(<TaskDetailScreen id="vt-1" />, {
      routes: [
        ...tasks([viewingTask({ response: 'Confirmed' })]),
        route('POST', '/v1/seller/viewings/vr-1/outcome', () => ({ body: {} })),
      ],
    });
    await fireEvent.press(await screen.findByText(en['scan.noShow']));
    expect(await screen.findByText(en['tasks.noShow.title'])).toBeTruthy();
    expect(h.calls.some((c) => c.method === 'POST')).toBe(false);
    await fireEvent.press(screen.getAllByText(en['scan.noShow']).at(-1)!);
    await waitFor(() => expect(h.calls.some((c) => c.method === 'POST')).toBe(true));
    expect(h.calls.find((c) => c.method === 'POST')?.body).toEqual({ outcome: 'No-show' });
  });

  it('says so when the task is no longer open', async () => {
    await renderApp(<TaskDetailScreen id="gone" />, { routes: tasks() });
    expect(await screen.findByText(en['tasks.notFound'])).toBeTruthy();
  });
});

const line = (state: string, over: Record<string, unknown> = {}) => ({
  id: 'ln-1',
  orderId: 'ord-1',
  productName: 'Oak Table',
  quantity: 1,
  unitPriceFils: 125_000,
  grossLineFils: 125_000,
  state,
  openIssues: 0,
  delivery: null,
  ...over,
});
const lines = (l: unknown) =>
  route('GET', '/v1/seller/order-lines', () => ({ body: { items: [l], nextCursor: null } }));

describe('LineScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('advances to the next state after confirmation', async () => {
    const h = await renderApp(<LineScreen id="ln-1" />, {
      routes: [
        lines(line('Confirmed')),
        route('POST', '/v1/seller/order-lines/ln-1/advance', () => ({ body: { changed: true } })),
      ],
    });
    await fireEvent.press(await screen.findByText(en['orders.advance.Preparing']));
    await fireEvent.press(await screen.findByText(en['common.confirm']));
    await waitFor(() => expect(h.calls.some((c) => c.method === 'POST')).toBe(true));
    expect(h.calls.find((c) => c.method === 'POST')?.body).toEqual({ to: 'Preparing' });
  });

  it('blocks "delivered" until a proof photo is uploaded, then sends its key', async () => {
    const h = await renderApp(<LineScreen id="ln-1" />, {
      routes: [
        lines(line('Dispatched')),
        route('POST', '/v1/seller/order-lines/ln-1/proof-upload', () => ({
          body: {
            storageKey: 'proof/ln-1/abc.jpg',
            uploadUrl: 'https://store.test/put',
            method: 'PUT',
            headers: { 'content-type': 'image/jpeg' },
          },
        })),
        route('POST', '/v1/seller/order-lines/ln-1/advance', () => ({ body: { changed: true } })),
      ],
    });
    expect(await screen.findByText(en['orders.proof.required'])).toBeTruthy();
    // Without a photo the advance button does nothing: no confirmation sheet opens.
    await fireEvent.press(screen.getByText(en['orders.advance.Delivered']));
    expect(screen.queryByText(/Move to/)).toBeNull();
    expect(h.calls.some((c) => c.path.endsWith('/advance'))).toBe(false);

    // Take the photo (picker is mocked; file:// and the signed URL are served by a stub fetch).
    const realFetch = globalThis.fetch;
    const stored: string[] = [];
    globalThis.fetch = (async (u: string, init?: RequestInit) => {
      if (String(u).startsWith('file:'))
        return new Response(new Blob(['x'.repeat(600)], { type: 'image/jpeg' }));
      stored.push(`${init?.method} ${u}`);
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    try {
      await fireEvent.press(screen.getByText(en['orders.proof.take']));
      await screen.findByText(en['orders.proof.retake']);
      expect(stored).toEqual(['PUT https://store.test/put']);
      await fireEvent.press(screen.getByText(en['orders.advance.Delivered']));
      await fireEvent.press(await screen.findByText(en['common.confirm']));
      await waitFor(() => expect(h.calls.some((c) => c.path.endsWith('/advance'))).toBe(true));
      expect(h.calls.find((c) => c.path.endsWith('/advance'))?.body).toEqual({
        to: 'Delivered',
        proofPhotoKey: 'proof/ln-1/abc.jpg',
      });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('cancelling needs a reason of at least three characters', async () => {
    const h = await renderApp(<LineScreen id="ln-1" />, {
      routes: [
        lines(line('Preparing')),
        route('POST', '/v1/seller/order-lines/ln-1/advance', () => ({ body: { changed: true } })),
      ],
    });
    await fireEvent.press(await screen.findByText(en['orders.cancel']));
    expect(await screen.findByText(en['orders.cancel.title'])).toBeTruthy();
    await fireEvent.press(screen.getAllByText(en['orders.cancel']).at(-1)!);
    expect(h.calls.some((c) => c.path.endsWith('/advance'))).toBe(false);
    await fireEvent.changeText(screen.getByLabelText(en['orders.cancel.reason']), 'Damaged');
    await fireEvent.press(screen.getAllByText(en['orders.cancel']).at(-1)!);
    await waitFor(() => expect(h.calls.some((c) => c.path.endsWith('/advance'))).toBe(true));
    expect(h.calls.find((c) => c.path.endsWith('/advance'))?.body).toEqual({
      to: 'Cancelled',
      reason: 'Damaged',
    });
  });
});

describe('useProof', () => {
  const upload = {
    storageKey: 'proof/k.jpg',
    uploadUrl: 'https://store.test/put',
    method: 'PUT' as const,
    headers: { 'content-type': 'image/jpeg' },
  };
  const photo = { canceled: false, assets: [{ uri: 'file:///p.jpg', mimeType: 'image/jpeg' }] };
  const blob = new Blob(['x'.repeat(2048)], { type: 'image/jpeg' });

  it('uploads straight to the signed URL and keeps the key', async () => {
    const proofUpload = jest.fn(async () => upload);
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return url.startsWith('file:') ? new Response(blob) : new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const { result } = await renderHook(() =>
      useProof('ln-1', { proofUpload } as never, {
        picker: {
          requestCameraPermissionsAsync: async () => ({ granted: true }),
          launchCameraAsync: async () => photo,
        } as never,
        fetch: f,
      }),
    );
    await act(async () => result.current.capture());
    expect(result.current.state).toMatchObject({ phase: 'ready', key: 'proof/k.jpg' });
    expect(proofUpload).toHaveBeenCalledWith('ln-1', 'image/jpeg', 2048);
    expect(calls.at(-1)).toMatchObject({ url: 'https://store.test/put', init: { method: 'PUT' } });
  });

  it('reports denied permission and failed uploads', async () => {
    const denied = await renderHook(() =>
      useProof('l', { proofUpload: jest.fn() } as never, {
        picker: {
          requestCameraPermissionsAsync: async () => ({ granted: false }),
          launchCameraAsync: jest.fn(),
        } as never,
      }),
    );
    await act(async () => denied.result.current.capture());
    expect(denied.result.current.state.phase).toBe('denied');

    const failed = await renderHook(() =>
      useProof('l', { proofUpload: async () => upload } as never, {
        picker: {
          requestCameraPermissionsAsync: async () => ({ granted: true }),
          launchCameraAsync: async () => photo,
        } as never,
        fetch: (async (u: string) =>
          u.startsWith('file:')
            ? new Response(blob)
            : new Response('no', { status: 403 })) as unknown as typeof fetch,
      }),
    );
    await act(async () => failed.result.current.capture());
    expect(failed.result.current.state.phase).toBe('failed');
  });

  it('putProof rejects a failed upload', async () => {
    await expect(
      putProof(
        upload,
        blob,
        (async () => new Response('x', { status: 500 })) as unknown as typeof fetch,
      ),
    ).rejects.toThrow();
  });
});

describe('order flow rules', () => {
  it('walks the order lifecycle and requires proof only for delivery', () => {
    expect(nextStep('Confirmed')).toEqual({ to: 'Preparing', needsProof: false });
    expect(nextStep('Dispatched')).toEqual({ to: 'Delivered', needsProof: true });
    expect(nextStep('Delivered')).toBeNull();
    expect(nextStep('Cancelled')).toBeNull();
    expect(canCancel('Delivered')).toBe(false);
    expect(canCancel('Preparing')).toBe(true);
  });
});
