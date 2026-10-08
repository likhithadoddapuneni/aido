import type { Selectable } from 'kysely';
import type { Viewing } from '@aidooi/contracts';
import type { DB } from '@aidooi/db';
import { fils, quoteDeposit, type Fils } from '@aidooi/domain';
import type { AppContext, Tx } from '../../context.ts';
import { notFound } from '../../http/problem.ts';
import { hashPass, issuePass, passSecret } from './qr.ts';

export type RequestRow = Selectable<DB['viewing.viewing_request']>;
export type StopRow = Selectable<DB['viewing.viewing_stop']>;
export type DepositRow = Selectable<DB['viewing.viewing_deposit']>;

export interface StopDetail extends StopRow {
  readonly partnerName: string;
  readonly locationName: string;
  readonly address: string;
  readonly products: readonly {
    readonly offerId: string;
    readonly productId: string;
    readonly name: string;
    readonly quantity: number;
    readonly unitPrice: Fils;
  }[];
}

export interface ViewingData {
  readonly request: RequestRow;
  readonly stops: readonly StopDetail[];
  readonly deposit: DepositRow | null;
}

export const iso = (d: Date | string): string => new Date(d).toISOString();

/** Lock the request row for the rest of the transaction; every state change starts here. */
export async function lockRequest(trx: Tx, id: string): Promise<RequestRow> {
  const row = await trx
    .selectFrom('viewing.viewing_request')
    .selectAll()
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw notFound('Viewing');
  return row;
}

export async function loadData(trx: Tx, id: string): Promise<ViewingData> {
  const request = await trx
    .selectFrom('viewing.viewing_request')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!request) throw notFound('Viewing');
  const stopRows = await trx
    .selectFrom('viewing.viewing_stop as s')
    .innerJoin('catalogue.partner as p', 'p.id', 's.partner_id')
    .innerJoin('catalogue.partner_location as l', 'l.id', 's.partner_location_id')
    .selectAll('s')
    .select(['p.trade_name as partner_name', 'l.name as location_name', 'l.address as address'])
    .where('s.viewing_request_id', '=', id)
    .orderBy('s.stop_no')
    .execute();
  const productRows = stopRows.length
    ? await trx
        .selectFrom('viewing.viewing_product as vp')
        .innerJoin('catalogue.product as pr', 'pr.id', 'vp.product_id')
        .select([
          'vp.stop_id',
          'vp.offer_id',
          'vp.product_id',
          'vp.quantity',
          'vp.unit_price_fils',
          'pr.name',
        ])
        .where(
          'vp.stop_id',
          'in',
          stopRows.map((s) => s.id),
        )
        .orderBy('vp.offer_id')
        .execute()
    : [];
  const deposit = await trx
    .selectFrom('viewing.viewing_deposit')
    .selectAll()
    .where('viewing_request_id', '=', id)
    .executeTakeFirst();
  return {
    request,
    deposit: deposit ?? null,
    stops: stopRows.map(({ partner_name, location_name, address, ...stop }) => ({
      ...stop,
      partnerName: partner_name,
      locationName: location_name,
      address,
      products: productRows
        .filter((p) => p.stop_id === stop.id)
        .map((p) => ({
          offerId: p.offer_id,
          productId: p.product_id,
          name: p.name,
          quantity: p.quantity,
          unitPrice: fils(Number(p.unit_price_fils)),
        })),
    })),
  };
}

/** Stops that will actually be visited: a declined stop drops out of the visit and of the deposit. */
export const visitedStops = (stops: readonly StopDetail[]) =>
  stops.filter((s) => s.confirmation_state !== 'Declined');

export const quoteFor = (stops: readonly StopDetail[]) =>
  quoteDeposit(
    visitedStops(stops).flatMap((s) =>
      s.products.map((p) => ({ offer: { sellingPrice: p.unitPrice }, qty: p.quantity })),
    ),
  );

/** All stops answered, at least one confirmed, at least one declined: the buyer chooses to go on or cancel. */
export const needsDecision = (d: ViewingData): boolean =>
  d.request.state === 'Awaiting Seller Confirmation' &&
  d.stops.every((s) => s.confirmation_state !== 'Pending') &&
  d.stops.some((s) => s.confirmation_state === 'Declined') &&
  d.stops.some((s) => s.confirmation_state === 'Confirmed');

/** The pass the buyer shows at the showroom, if one has been issued and still matches what we stored. */
export function passFor(ctx: AppContext, r: RequestRow) {
  if (r.state !== 'Confirmed' || !r.scheduled_at || !r.qr_token_hash) return null;
  const pass = issuePass(passSecret(ctx.config), r.id, new Date(r.scheduled_at).getTime());
  return pass.hash === r.qr_token_hash ? pass : null;
}

export function toView(ctx: AppContext, d: ViewingData): Viewing {
  const quote = quoteFor(d.stops);
  const pass = passFor(ctx, d.request);
  return {
    id: d.request.id,
    state: d.request.state as Viewing['state'],
    compositionId: d.request.composition_id,
    scheduledAt: d.request.scheduled_at ? iso(d.request.scheduled_at) : null,
    stops: d.stops.map((s) => ({
      id: s.id,
      stopNo: s.stop_no,
      partnerName: s.partnerName,
      locationName: s.locationName,
      address: s.address,
      confirmation: s.confirmation_state as 'Pending' | 'Confirmed' | 'Declined',
      attendance: s.attendance as 'Attended' | 'No-show' | null,
      products: [...s.products],
    })),
    depositQuote: { base: quote.base, amount: quote.amount, capped: quote.capped },
    deposit: d.deposit
      ? {
          state: d.deposit.state as NonNullable<Viewing['deposit']>['state'],
          amount: fils(Number(d.deposit.amount_fils)),
          credited: d.deposit.credited_fils === null ? null : fils(Number(d.deposit.credited_fils)),
        }
      : null,
    needsDecision: needsDecision(d),
    pass: pass?.token ?? null,
    createdAt: iso(d.request.created_at),
  };
}

export { hashPass };
