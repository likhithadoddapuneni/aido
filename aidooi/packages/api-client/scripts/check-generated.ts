import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// The generated types must match the committed OpenAPI document: regenerate to a temp file and compare.
const root = path.resolve(import.meta.dirname, '..');
const target = path.join(root, 'src/generated/schema.d.ts');
const tmp = path.join(root, 'src/generated/.check.d.ts');
execFileSync('pnpm', ['exec', 'openapi-typescript', '../contracts/openapi.json', '-o', tmp], {
  cwd: root,
  stdio: 'ignore',
});
const same = readFileSync(tmp, 'utf8') === readFileSync(target, 'utf8');
execFileSync('rm', [tmp]);
if (!same) {
  console.error(
    'generated API types are out of date; run `pnpm --filter @aidooi/api-client generate`',
  );
  process.exit(1);
}
console.log('generated API types are up to date');
