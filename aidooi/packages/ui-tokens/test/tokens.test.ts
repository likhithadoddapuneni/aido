import { describe, expect, it } from 'vitest';
import { CONTENT_PAIRS, breakpoint, color, contrast, space, touchTarget } from '../src/index.ts';

describe('contrast maths', () => {
  it('matches the WCAG reference values', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrast('#767676', '#FFFFFF')).toBeGreaterThan(4.5); // the well-known AA grey
    expect(contrast('#777777', '#FFFFFF')).toBeLessThan(4.6);
    expect(contrast(color.navy, color.ivory)).toBe(contrast(color.ivory, color.navy));
  });
  it('rejects malformed colours', () => {
    expect(() => contrast('#fff', '#000')).toThrow();
  });
});

describe('GATE: every content colour pairing meets WCAG AA', () => {
  it.each(CONTENT_PAIRS)('$name ≥ $min', ({ fg, bg, min }) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(min);
  });

  it('REGRESSION: the standard’s own secondary grey fails AA on cards, which is why the extended token exists', () => {
    expect(contrast(color.text2, color.surface)).toBeLessThan(4.5);
    expect(contrast(color.text2OnSurface, color.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('the decorative colours are NOT usable for text, and the system knows it', () => {
    // Beige is a restrained accent and placeholder grey is not content: neither may carry meaning as text.
    expect(contrast(color.beige, color.ivory)).toBeLessThan(3);
    expect(contrast(color.text3, color.ivory)).toBeLessThan(4.5);
    for (const p of CONTENT_PAIRS) {
      expect([color.beige, color.text3]).not.toContain(p.fg);
    }
  });
});

describe('scales', () => {
  it('spacing follows the standard 4 / 8 / 16 / 24 / 32 / 48 / 64', () => {
    expect([space[1], space[2], space[3], space[4], space[5], space[6], space[7]]).toEqual([
      4, 8, 16, 24, 32, 48, 64,
    ]);
  });
  it('breakpoints ascend and touch targets are at least 44', () => {
    const b = Object.values(breakpoint);
    expect(b).toEqual([...b].sort((x, y) => x - y));
    expect(touchTarget).toBeGreaterThanOrEqual(44);
  });
});
