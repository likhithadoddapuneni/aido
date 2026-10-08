import type { StatementDetailSchema } from '@aidooi/contracts';
import type { z } from 'zod';
import type { Tx } from '../../context.ts';
import { notFound } from '../../http/problem.ts';
import { decodeCursor, pageOf } from '../../http/pagination.ts';
import { sql } from 'kysely';

export type StatementDetail = z.infer<typeof StatementDetailSchema>;

export async function listStatements(
  trx: Tx,
  partnerId: string,
  opts: { limit: number; cursor?: string | undefined },
) {
  const cursor = decodeCursor(opts.cursor);
  let q = trx
    .selectFrom('settlement.statement as s')
    .innerJoin('settlement.settlement_run as r', 'r.id', 's.run_id')
    .select([
      's.id',
      's.run_id',
      'r.period',
      'r.state',
      'r.net_fils',
      's.issued_at',
      sql<string>`s.issued_at::text`.as('issued_text'),
    ])
    .where('s.partner_id', '=', partnerId)
    .orderBy('s.issued_at', 'desc')
    .orderBy('s.id', 'desc')
    .limit(opts.limit + 1);
  if (cursor)
    q = q.where(sql<boolean>`(s.issued_at, s.id) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)`);
  const rows = await q.execute();
  const page = pageOf(rows, opts.limit, (r) => ({ t: r.issued_text, id: r.id }));
  return {
    items: page.items.map((r) => ({
      id: r.id,
      runId: r.run_id,
      period: r.period,
      state: r.state as 'Draft' | 'Approved' | 'Paid',
      netFils: r.net_fils,
      issuedAt: new Date(r.issued_at).toISOString(),
    })),
    nextCursor: page.nextCursor,
  };
}

export async function statementDetail(
  trx: Tx,
  partnerId: string,
  id: string,
): Promise<StatementDetail> {
  const head = await trx
    .selectFrom('settlement.statement as s')
    .innerJoin('settlement.settlement_run as r', 'r.id', 's.run_id')
    .select([
      's.id',
      's.run_id',
      's.issued_at',
      's.tax_invoice_no',
      'r.period',
      'r.state',
      'r.gross_fils',
      'r.commission_fils',
      'r.adjustment_fils',
      'r.net_fils',
    ])
    .where('s.id', '=', id)
    .where('s.partner_id', '=', partnerId)
    .executeTakeFirst();
  if (!head) throw notFound('Statement');
  const lines = await trx
    .selectFrom('settlement.settlement_line as sl')
    .innerJoin('fulfilment.order_line as l', 'l.id', 'sl.order_line_id')
    .innerJoin('catalogue.product as p', 'p.id', 'l.product_id')
    .select(['sl.order_line_id', 'sl.kind', 'p.name', 'sl.gross_fils', 'sl.commission_fils'])
    .where('sl.run_id', '=', head.run_id)
    .orderBy('sl.kind')
    .orderBy('sl.order_line_id')
    .execute();
  return {
    id: head.id,
    runId: head.run_id,
    period: head.period,
    state: head.state as StatementDetail['state'],
    netFils: head.net_fils,
    issuedAt: new Date(head.issued_at).toISOString(),
    taxInvoiceNo: head.tax_invoice_no,
    grossFils: head.gross_fils,
    commissionFils: head.commission_fils,
    adjustmentFils: head.adjustment_fils,
    lines: lines.map((l) => ({
      orderLineId: l.order_line_id,
      kind: l.kind as 'Sale' | 'Clawback',
      productName: l.name,
      grossFils: l.gross_fils,
      commissionFils: l.commission_fils,
      netFils: l.gross_fils - l.commission_fils,
    })),
  };
}

const dirhams = (fils: number): string => {
  const sign = fils < 0 ? '-' : '';
  const abs = Math.abs(fils);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};

/** Neutralise spreadsheet formula injection and quote anything CSV treats specially. */
const cell = (v: string): string => {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

export function statementCsv(s: StatementDetail): string {
  const rows = [
    ['kind', 'order_line_id', 'product', 'gross_aed', 'commission_aed', 'net_aed'],
    ...s.lines.map((l) => [
      l.kind,
      l.orderLineId,
      l.productName,
      dirhams(l.kind === 'Clawback' ? -l.grossFils : l.grossFils),
      dirhams(l.kind === 'Clawback' ? -l.commissionFils : l.commissionFils),
      dirhams(l.kind === 'Clawback' ? -l.netFils : l.netFils),
    ]),
    [],
    ['period', s.period, 'tax_invoice', s.taxInvoiceNo ?? '', 'net_aed', dirhams(s.netFils)],
  ];
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
