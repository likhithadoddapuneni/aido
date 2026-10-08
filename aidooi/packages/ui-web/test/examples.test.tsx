import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../playground/examples.tsx';
import { LOCALES, expectNoViolations, renderIn } from './helpers.tsx';

/**
 * One sweep over every component example, in both languages, in its most demanding state:
 *  - GATE: no WCAG violation axe can detect (axe finds roughly half of real issues; the other half
 *    is covered by the keyboard and wiring tests below),
 *  - RTL: the document flips direction, and the markup is snapshotted so an accidental change to
 *    structure (which would break the logical-property layout) shows up in review.
 */
describe.each(LOCALES)('every component, locale %s', (locale) => {
  it.each(EXAMPLES.map((e) => [e.id, e] as const))('%s is accessible', async (_id, example) => {
    const { baseElement } = renderIn(<>{example.open ?? example.element}</>, locale);
    await expectNoViolations(baseElement);
  });

  it.each(EXAMPLES.map((e) => [e.id, e] as const))(
    '%s sets direction and renders stably',
    (_id, example) => {
      const { container } = renderIn(<>{example.element}</>, locale);
      expect(document.documentElement.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      expect(document.documentElement.lang).toBe(locale);
      if (locale === 'ar') expect(container.innerHTML).toMatchSnapshot();
    },
  );
});
