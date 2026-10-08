import { ar } from './catalogue.ar.ts';
import { en } from './catalogue.en.ts';

export { type TxKey } from './catalogue.en.ts';
export const catalogue = { en, ar } as const;
