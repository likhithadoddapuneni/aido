import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withScratchDatabase } from '../testing/harness.ts';

const bin = fileURLToPath(new URL('../../node_modules/.bin/kysely-codegen', import.meta.url));
const outFile = fileURLToPath(new URL('../generated/db.ts', import.meta.url));
const check = process.argv.includes('--check');

// bigint columns are money in fils; src/client.ts parses int8 to number (and throws if unsafe),
// so the generated types must say number.
const INT8_DECLARATION = /export type Int8 = ColumnType<[^;]+;/;
const INT8_AS_NUMBER = 'export type Int8 = ColumnType<number, number | string, number | string>;';

await withScratchDatabase(async (url) => {
  const raw = execFileSync(
    bin,
    [
      '--dialect',
      'postgres',
      '--url',
      url,
      '--print',
      '--log-level',
      'error',
      '--numeric-parser',
      'string',
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  if (!INT8_DECLARATION.test(raw))
    throw new Error('kysely-codegen output has no Int8 declaration to rewrite');
  const generated = raw.replace(INT8_DECLARATION, INT8_AS_NUMBER);

  if (check) {
    const current = readFileSync(outFile, 'utf8');
    if (current !== generated) {
      console.error(
        'src/generated/db.ts is stale. Run `pnpm --filter @aidooi/db db:codegen` and commit the result.',
      );
      process.exit(1);
    }
    console.log('generated types are up to date');
  } else {
    writeFileSync(outFile, generated);
    console.log(`wrote ${outFile}`);
  }
});
