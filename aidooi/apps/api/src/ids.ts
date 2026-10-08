import { v7 } from 'uuid';
import type { IdGenerator } from './ports.ts';

export const uuidV7Generator: IdGenerator = { uuid: () => v7() };
