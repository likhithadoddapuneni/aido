/** Print the current authenticator code for a demo login:  pnpm demo:totp finance1@demo.aidooi.test */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { base32Decode, hotp, stepAt } from '../src/modules/auth/totp.ts';

const file = path.resolve(import.meta.dirname, '../../../.demo/credentials.json');
const creds = JSON.parse(readFileSync(file, 'utf8')) as { email: string; totpSeed: string }[];
const who = process.argv[2];
const c = creds.find((x) => x.email === who);
if (!c) {
  console.error(`Unknown login. Choose one of:\n  ${creds.map((x) => x.email).join('\n  ')}`);
  process.exit(1);
}
const now = Date.now();
const secondsLeft = 30 - (Math.floor(now / 1000) % 30);
console.log(`${hotp(base32Decode(c.totpSeed), stepAt(now))}   (valid for ~${secondsLeft}s)`);
