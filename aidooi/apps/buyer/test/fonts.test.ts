import { FACE_NAMES } from '@aidooi/ui-native';
import { FONT_FACES } from '../src/theme/fonts.ts';

describe('typefaces', () => {
  it('GATE: every face the Text component can ask for is registered, and nothing else is shipped', () => {
    expect(Object.keys(FONT_FACES).sort()).toEqual([...FACE_NAMES].sort());
  });

  it('every registered face resolves to a font asset', () => {
    for (const [name, asset] of Object.entries(FONT_FACES))
      expect([name, asset !== undefined]).toEqual([name, true]);
  });
});
