import { useT } from '@aidooi/ui-native';
import { catalogue, type TxKey } from './catalogue.ts';

/** `const t = useTx(); t('home.title')`. Copy lives only in the catalogue, in both languages. */
export const useTx = () => useT(catalogue);
export type Tx = ReturnType<typeof useTx>;

/** Enumerated values (styles, colours, tiers…) have catalogue keys of the form `prefix.value`. */
export const keyFor = (prefix: string, value: string): TxKey => `${prefix}.${value}` as TxKey;
