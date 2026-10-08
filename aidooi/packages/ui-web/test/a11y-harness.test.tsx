import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';

describe('the accessibility check itself', () => {
  it('is not vacuous: it fails on markup with known violations', async () => {
    const { container } = render(
      <div>
        <img src="x.png" />
        <button />
        <input />
      </div>,
    );
    const results = await axe(container);
    expect(results.violations.map((v) => v.id)).toEqual(
      expect.arrayContaining(['image-alt', 'button-name', 'label']),
    );
  });
});
