import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * REGRESSION: Expo Router uses `src/app` as the route root whenever that folder exists, ahead of `app`.
 * The seller app once kept helper files in `src/app`, so the dev server showed no screens at all while
 * every unit test passed. Helpers live elsewhere; `app/` is the only route root.
 */
describe('Expo Router route root', () => {
  it('has no src/app folder to hijack the app/ routes', () => {
    expect(existsSync(path.resolve(__dirname, '../src/app'))).toBe(false);
    expect(existsSync(path.resolve(__dirname, '../app/_layout.tsx'))).toBe(true);
  });
});
