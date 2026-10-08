import react from '@vitejs/plugin-react';
import { mergeConfig, type UserConfig } from 'vite';

/**
 * The toolchain every AIDOOi web app shares. An app's `vite.config.ts` is
 * `export default defineAppConfig({ server: { proxy: { ... } } })`.
 *
 * Workspace packages (`@aidooi/*`) are TypeScript consumed as source. They resolve through pnpm
 * symlinks to real paths outside node_modules, so Vite transpiles them like app code: no build step.
 */
export function defineAppConfig(overrides: UserConfig = {}): UserConfig {
  return mergeConfig(
    {
      plugins: [react()],
      build: { target: 'es2023', sourcemap: true },
      server: { port: 5173 },
    } satisfies UserConfig,
    overrides,
  );
}
