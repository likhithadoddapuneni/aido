import { unwrap, type Api } from '@aidooi/api-client';
import type { z } from 'zod';
import type {
  AddressSchema,
  BuyerOrderSchema,
  BuyerOrderPageSchema,
  CheckoutSchema,
  ConsentSchema,
  CustomerSchema,
  DataExportSchema,
  DeliverySchema,
  DepositResultSchema,
  MeSchema,
  PassSchema,
  PayResponseSchema,
  ViewingSchema,
} from '@aidooi/contracts';

export type Viewing = z.infer<typeof ViewingSchema>;
export type Checkout = z.infer<typeof CheckoutSchema>;
export type Delivery = z.infer<typeof DeliverySchema>;
export type PayResponse = z.infer<typeof PayResponseSchema>;
export type DepositResult = z.infer<typeof DepositResultSchema>;
export type Pass = z.infer<typeof PassSchema>;
export type BuyerOrder = z.infer<typeof BuyerOrderSchema>;
export type BuyerOrderPage = z.infer<typeof BuyerOrderPageSchema>;
export type Address = z.infer<typeof AddressSchema>;
export type Consent = z.infer<typeof ConsentSchema>;
export type Me = z.infer<typeof MeSchema>;
export type Customer = z.infer<typeof CustomerSchema>;
export type DataExport = z.infer<typeof DataExportSchema>;

export type AddressInput = Omit<Address, 'id' | 'isDefault'> & { isDefault?: boolean };
export type CheckoutSource =
  | { kind: 'composition'; compositionId: string }
  | { kind: 'lines'; lines: { offerId: string; quantity: number; expectedUnitPrice: number }[] };

const idem = (key: string) => ({ 'idempotency-key': key });

/**
 * Every call the transaction screens make. Anything that spends money or creates something takes the
 * caller's idempotency key: the screen owns the key for a user intent and reuses it on every retry.
 * Responses are validated against the contract schemas by the smoke script on a real API.
 */
export function transactServices(api: Api) {
  const http = api.http;
  const call = <T>(p: Promise<{ data?: unknown; error?: unknown; response: Response }>) =>
    unwrap(p as never) as Promise<T>;
  const path = (id: string) => ({ params: { path: { id } } });
  const noContent = async (p: Promise<{ error?: unknown; response: Response }>) => {
    await unwrap(p as never);
  };

  return {
    /* ---- viewings ---- */
    createViewing: (body: { compositionId: string; itemSlotKeys?: string[] }, key: string) =>
      call<Viewing>(http.POST('/v1/viewings' as never, { body, headers: idem(key) } as never)),
    listViewings: () => call<Viewing[]>(http.GET('/v1/viewings' as never, {} as never)),
    getViewing: (id: string) =>
      call<Viewing>(http.GET('/v1/viewings/{id}' as never, path(id) as never)),
    continueViewing: (id: string) =>
      call<Viewing>(http.POST('/v1/viewings/{id}/continue' as never, path(id) as never)),
    cancelViewing: (id: string) =>
      call<Viewing>(http.POST('/v1/viewings/{id}/cancel' as never, path(id) as never)),
    payDeposit: (id: string, body: { paymentToken: string; scheduledAt: string }, key: string) =>
      call<DepositResult>(
        http.POST(
          '/v1/viewings/{id}/deposit' as never,
          { ...path(id), body, headers: idem(key) } as never,
        ),
      ),
    getPass: (id: string) =>
      call<Pass>(http.GET('/v1/viewings/{id}/pass' as never, path(id) as never)),

    /* ---- checkout ---- */
    startCheckout: (body: { source: CheckoutSource; viewingRequestId?: string }, key: string) =>
      call<Checkout>(http.POST('/v1/checkout' as never, { body, headers: idem(key) } as never)),
    getCheckout: (id: string) =>
      call<Checkout>(
        http.GET(
          '/v1/checkout/{checkoutId}' as never,
          { params: { path: { checkoutId: id } } } as never,
        ),
      ),
    approvePrices: (id: string, approvedTotal: number) =>
      call<Checkout>(
        http.POST(
          '/v1/checkout/{checkoutId}/approve-prices' as never,
          { params: { path: { checkoutId: id } }, body: { approvedTotal } } as never,
        ),
      ),
    pay: (id: string, body: { paymentToken: string; delivery: Delivery }, key: string) =>
      call<PayResponse>(
        http.POST(
          '/v1/checkout/{checkoutId}/pay' as never,
          { params: { path: { checkoutId: id } }, body, headers: idem(key) } as never,
        ),
      ),

    /* ---- orders ---- */
    listOrders: (cursor?: string) =>
      call<BuyerOrderPage>(
        http.GET(
          '/v1/orders' as never,
          { params: { query: { limit: 20, ...(cursor ? { cursor } : {}) } } } as never,
        ),
      ),
    getOrder: (orderId: string) =>
      call<BuyerOrder>(
        http.GET('/v1/orders/{orderId}' as never, { params: { path: { orderId } } } as never),
      ),
    confirmReceipt: (orderId: string, lineId: string) =>
      call<unknown>(
        http.POST(
          '/v1/orders/{orderId}/lines/{lineId}/confirm-receipt' as never,
          { params: { path: { orderId, lineId } } } as never,
        ),
      ),
    raiseIssue: (orderId: string, lineId: string, body: { flag: string; note?: string }) =>
      call<{ id: string }>(
        http.POST(
          '/v1/orders/{orderId}/lines/{lineId}/issues' as never,
          { params: { path: { orderId, lineId } }, body } as never,
        ),
      ),

    /* ---- account ---- */
    me: () => call<Me>(http.GET('/v1/me' as never, {} as never)),
    patchMe: (body: { fullName?: string; locale?: 'en' | 'ar'; email?: string }) =>
      call<Customer>(http.PATCH('/v1/me' as never, { body } as never)),
    listAddresses: () => call<Address[]>(http.GET('/v1/me/addresses' as never, {} as never)),
    createAddress: (body: AddressInput) =>
      call<Address>(http.POST('/v1/me/addresses' as never, { body } as never)),
    updateAddress: (id: string, body: AddressInput) =>
      call<Address>(http.PUT('/v1/me/addresses/{id}' as never, { ...path(id), body } as never)),
    deleteAddress: (id: string) =>
      noContent(http.DELETE('/v1/me/addresses/{id}' as never, path(id) as never)),
    grantConsent: (purpose: string, policyVersion: string) =>
      call<Consent>(
        http.PUT(
          '/v1/me/consent/{purpose}' as never,
          { params: { path: { purpose } }, body: { policyVersion } } as never,
        ),
      ),
    withdrawConsent: (purpose: string) =>
      noContent(
        http.DELETE(
          '/v1/me/consent/{purpose}' as never,
          { params: { path: { purpose } } } as never,
        ),
      ),
    registerDevice: (body: {
      platform: 'ios' | 'android' | 'web';
      pushToken: string;
      appVersion?: string;
    }) => noContent(http.PUT('/v1/me/devices' as never, { body } as never)),
    removeDevice: (pushToken: string) =>
      noContent(http.DELETE('/v1/me/devices' as never, { body: { pushToken } } as never)),
    exportData: () => call<DataExport>(http.GET('/v1/me/export' as never, {} as never)),
    erase: () => call<{ status: 'erased' }>(http.POST('/v1/me/erasure' as never, {} as never)),
  };
}

export type TransactServices = ReturnType<typeof transactServices>;
