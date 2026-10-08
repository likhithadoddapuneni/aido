import path from 'node:path';
import { defineAppConfig } from '../vite.config.base.ts';

export default defineAppConfig({
  root: path.resolve(import.meta.dirname),
  build: { outDir: 'dist', emptyOutDir: true },
});
