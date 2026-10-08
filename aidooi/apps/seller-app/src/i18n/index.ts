import { ar } from './ar.ts';
import { en, type StringKey } from './strings.ts';

export const catalogue = { en, ar } as const;
export type { StringKey };
