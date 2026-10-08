import { parse } from 'csv-parse/sync';
import { HttpError } from '../../http/problem.ts';

/** Columns of the seller import template, in order. Required ones are validated per row, not just by header. */
export const IMPORT_COLUMNS = [
  'sku',
  'product_id',
  'name',
  'type',
  'width_cm',
  'depth_cm',
  'height_cm',
  'primary_colour',
  'secondary_colour',
  'primary_style',
  'secondary_style',
  'material',
  'seats',
  'bed_size',
  'capacity',
  'door_group',
  'rug_size',
  'adjustable',
  'cable_management',
  'price_aed',
  'original_price_aed',
  'stock',
  'delivery_days',
  'viewing_status',
  'location',
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];
export type RawRow = Partial<Record<ImportColumn, string>>;

const REQUIRED_HEADERS: readonly ImportColumn[] = ['sku', 'price_aed', 'stock', 'delivery_days'];
const MAX_CELL = 1000;

export function templateCsv(): string {
  const example = [
    'SOFA-ORLA-3',
    '',
    'Orla Sofa',
    'Sofa',
    '215',
    '92',
    '82',
    'beige',
    '',
    'scandinavian',
    'minimalist',
    'Fabric',
    '3',
    '',
    '',
    '',
    '',
    '',
    '',
    '4200.00',
    '4800.00',
    '6',
    '5',
    'On Display',
    'Main showroom',
  ];
  return `${IMPORT_COLUMNS.join(',')}\r\n${example.map(cell).join(',')}\r\n`;
}

/**
 * Parse a seller's CSV. Headers are matched case-insensitively and a UTF-8 byte-order mark (Excel adds
 * one) is ignored. Unknown columns are refused rather than silently dropped: a typo in a header would
 * otherwise import a catalogue with a column of data quietly missing.
 */
export function parseImportCsv(text: string, maxRows: number): RawRow[] {
  let records: string[][];
  try {
    records = parse(text, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: false,
      trim: true,
      to_line: maxRows + 2,
    }) as string[][];
  } catch (e) {
    throw new HttpError(
      422,
      'csv_malformed',
      `The file is not valid CSV: ${e instanceof Error ? e.message : 'unreadable'}.`,
    );
  }
  const header = records[0]?.map((h) => h.toLowerCase());
  if (!header) throw new HttpError(422, 'csv_empty', 'The file has no header row.');
  const unknown = header.filter((h) => !(IMPORT_COLUMNS as readonly string[]).includes(h));
  const missing = REQUIRED_HEADERS.filter((h) => !header.includes(h));
  if (unknown.length || missing.length || new Set(header).size !== header.length) {
    const parts = [
      unknown.length ? `unknown column(s): ${unknown.join(', ')}` : '',
      missing.length ? `missing column(s): ${missing.join(', ')}` : '',
      new Set(header).size !== header.length ? 'duplicate column names' : '',
    ].filter(Boolean);
    throw new HttpError(422, 'csv_header_invalid', `Fix the header row — ${parts.join('; ')}.`);
  }
  const rows = records.slice(1);
  if (rows.length === 0) throw new HttpError(422, 'csv_empty', 'The file has no data rows.');
  if (rows.length > maxRows)
    throw new HttpError(
      422,
      'import_too_large',
      `Imports are limited to ${maxRows} rows; this file has more. Split it and import in parts.`,
    );
  return rows.map((r) => {
    const row: RawRow = {};
    header.forEach((h, i) => {
      const v = (r[i] ?? '').slice(0, MAX_CELL);
      if (v !== '') row[h as ImportColumn] = v;
    });
    return row;
  });
}

/**
 * A spreadsheet treats a cell starting with `=`, `+`, `-`, `@`, tab or CR as a formula. Anything we
 * write back to a file a person will open is neutralised with a leading apostrophe and always quoted.
 */
export function cell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}

export const toCsv = (rows: readonly (readonly (string | number | null)[])[]): string =>
  rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
