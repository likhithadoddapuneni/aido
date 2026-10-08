// Bundle the API and the worker into single ESM files for the production image. Workspace packages are
// TypeScript consumed as source, so they must be bundled; native add-ons cannot be, and stay external.
import { build } from 'esbuild';

await build({
  entryPoints: {
    main: 'src/main.ts',
    worker: 'src/worker-main.ts',
    // The same image migrates the database, so a deploy needs no second artefact.
    migrate: '../../packages/db/src/cli/migrate.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: ['@node-rs/argon2'],
  // Some CommonJS dependencies call require() at load time; give them one.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});
