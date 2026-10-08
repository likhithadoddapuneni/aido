import { randomUUID } from 'expo-crypto';

/** React Native has no `crypto.randomUUID`; correlation ids and idempotency keys come from expo-crypto. */
export const uuid = (): string => randomUUID();
