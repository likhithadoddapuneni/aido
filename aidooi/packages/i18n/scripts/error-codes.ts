import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Every error code the API can return, found by reading its source. Codes the framework produces are
 * listed explicitly; codes the modules raise are matched from the helpers and constructors that carry them.
 * Dynamic codes (a variable passed through) are not visible here — modules keep those to a minimum.
 */
const FRAMEWORK = [
  'validation_failed',
  'rate_limited',
  'internal_error',
  'route_not_found',
  'bad_request',
  'app_version_unsupported',
  'not_found',
  'unauthorized',
  'forbidden',
  'registration_required',
  'invalid_token',
  'idempotency_key_required',
  'idempotency_key_reuse',
  'request_in_progress',
];

const PATTERNS: RegExp[] = [
  /\b(?:conflict|badRequest|unprocessable)\(\s*'([a-z][a-z0-9_]+)'/g,
  /new HttpError\(\s*\d{3}\s*,\s*'([a-z][a-z0-9_]+)'/g,
  /new RuleViolation\(\s*'([a-z][a-z0-9_]+)'/g,
  /\bcode:\s*'([a-z][a-z0-9_]+)'/g,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

export function collectErrorCodes(apiSrc: string, domainSrc: string): string[] {
  const codes = new Set<string>(FRAMEWORK);
  for (const file of [...walk(apiSrc), ...walk(domainSrc)]) {
    const text = readFileSync(file, 'utf8');
    for (const re of PATTERNS) {
      for (const m of text.matchAll(re)) codes.add(m[1] as string);
    }
  }
  return [...codes].sort();
}
