import {
  PATH_IDS,
  STEP_FIELDS,
  buildInput,
  finalInput,
  isMultiRoom,
  parseNumber,
  validateStep,
  wizardSteps,
  type Draft,
  type PathId,
} from '../src/projects/wizard.ts';

/** The smallest answer that satisfies each path. */
const MINIMAL: Record<PathId, Draft> = {
  livingRoom: { lengthM: '5', widthM: '4' },
  bedroom: { lengthM: '4', widthM: '3.5', bedSize: 'Queen' },
  diningRoom: { lengthM: '4', widthM: '3.5', capacity: '6' },
  homeOffice: { lengthM: '3', widthM: '3', users: '1' },
  studio: { totalAreaM2: '38', sleepingSetup: 'Queen Bed', totalBudgetAed: '40000' },
  fullApartment: { bedrooms: '2', totalBudgetAed: '80000' },
  villa: { floors: '2', bedrooms: '4', totalBudgetAed: '250000' },
  individualProduct: { productType: 'Floor Lamp' },
};

describe('every path validates with the SAME schema the server uses', () => {
  it.each(PATH_IDS)('%s: a minimal answer is accepted and produces a request body', (id) => {
    const r = finalInput(id, {
      style: 'assisted',
      colour: 'assisted',
      tier: 'Standard',
      ...MINIMAL[id],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.pathId).toBe(id);
  });

  it.each(PATH_IDS)(
    '%s: an empty answer reports exactly the required fields of that path',
    (id) => {
      const r = finalInput(id, { style: 'assisted', colour: 'assisted' });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(Object.keys(r.errors).length).toBeGreaterThan(0);
        // Nothing is asked that the path does not need (lean input).
        const asked = new Set<string>([
          ...STEP_FIELDS.space(id),
          ...STEP_FIELDS.taste(),
          ...STEP_FIELDS.budget(id),
        ]);
        for (const k of Object.keys(r.errors)) expect(asked.has(k)).toBe(true);
      }
    },
  );

  it('a room asks no budget on the wizard; a property and a single product do', () => {
    expect(wizardSteps('livingRoom')).toEqual(['space', 'taste']);
    expect(wizardSteps('bedroom')).toEqual(['space', 'taste']);
    for (const id of ['studio', 'fullApartment', 'villa', 'individualProduct'] as const) {
      expect(wizardSteps(id)).toEqual(['space', 'taste', 'budget']);
    }
    expect(isMultiRoom('villa')).toBe(true);
    expect(isMultiRoom('livingRoom')).toBe(false);
  });

  it('no path asks the buyer for a size class', () => {
    for (const id of PATH_IDS) {
      const all = [
        ...STEP_FIELDS.space(id),
        ...STEP_FIELDS.taste(),
        ...STEP_FIELDS.budget(id),
      ] as string[];
      expect(all.some((k) => /size.?class/i.test(k))).toBe(false);
    }
  });
});

describe('typing numbers the way people do', () => {
  it('accepts a decimal comma, Arabic-Indic digits and stray spaces', () => {
    expect(parseNumber('4,5')).toBe(4.5);
    expect(parseNumber(' ٤٫٥ '.replace('٫', '.'))).toBe(4.5);
    expect(parseNumber('٣')).toBe(3);
    expect(parseNumber('')).toBeUndefined();
    expect(parseNumber('abc')).toBeNaN();
  });

  it('a comma and Arabic digits produce the same request as the plain version', () => {
    const plain = finalInput('livingRoom', {
      lengthM: '4.5',
      widthM: '3',
      style: 'modern',
      colour: 'grey',
    });
    const typed = finalInput('livingRoom', {
      lengthM: '٤,٥',
      widthM: '٣',
      style: 'modern',
      colour: 'grey',
    });
    expect(typed).toEqual(plain);
  });
});

describe('field errors', () => {
  it('distinguishes missing, malformed and out-of-range', () => {
    const r = buildInput('livingRoom', {
      lengthM: 'x',
      widthM: '999',
      style: 'modern',
      colour: 'grey',
      tier: 'Standard',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toMatchObject({ lengthM: 'invalid', widthM: 'range' });
    const missing = buildInput('bedroom', {
      lengthM: '4',
      widthM: '4',
      style: 'modern',
      colour: 'grey',
      tier: 'Value',
    });
    if (!missing.ok) expect(missing.errors).toEqual({ bedSize: 'required' });
  });

  it('validating one step reports only that step’s problems, not the steps ahead', () => {
    expect(validateStep('livingRoom', {}, 'space')).toEqual({
      lengthM: 'required',
      widthM: 'required',
    });
    expect(validateStep('livingRoom', { lengthM: '5', widthM: '4' }, 'space')).toEqual({});
    expect(
      validateStep('livingRoom', { lengthM: '5', widthM: '4', style: 'nope' }, 'taste'),
    ).toMatchObject({ style: 'invalid' });
    expect(validateStep('villa', { floors: '2', bedrooms: '3' }, 'budget')).toEqual({});
  });

  it('a budget field maps to the contract’s fils field and back to a buyer-facing key', () => {
    const r = buildInput('studio', {
      totalAreaM2: '30',
      sleepingSetup: 'Sofa Bed',
      style: 'modern',
      colour: 'grey',
      tier: 'Value',
      totalBudgetAed: '0',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors)).toEqual(['totalBudgetAed']);
    const ok = buildInput('studio', {
      totalAreaM2: '30',
      sleepingSetup: 'Sofa Bed',
      style: 'modern',
      colour: 'grey',
      tier: 'Value',
      totalBudgetAed: '12 000'.replace(' ', ''),
    });
    expect(ok.ok && 'totalBudgetFils' in ok.input && ok.input.totalBudgetFils).toBe(1_200_000);
  });
});

describe('apartments and villas (AID-SPC-007/008)', () => {
  const base: Draft = {
    bedrooms: '3',
    totalBudgetAed: '90000',
    style: 'scandinavian',
    colour: 'assisted',
    tier: 'Standard',
    floors: '2',
  };

  it('bedroom sizes and bed sizes are positional: the master comes first and later entries may be left blank at the end', () => {
    const r = buildInput('fullApartment', {
      ...base,
      bedroomAreasM2: ['20', '', ''],
      bedSizes: ['King', '', ''],
    });
    expect(r.ok).toBe(true);
    if (r.ok && r.input.pathId === 'fullApartment') {
      expect(r.input.bedroomAreasM2).toEqual([20]);
      expect(r.input.bedSizes).toEqual(['King']);
    }
  });

  it('a gap before a filled bedroom is an error, not a silent shift of everyone’s size', () => {
    const r = buildInput('fullApartment', { ...base, bedroomAreasM2: ['20', '', '14'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.bedroomAreasM2).toBe('invalid');
  });

  it('consistency and office default to off and are sent as booleans', () => {
    const r = buildInput('villa', base);
    expect(
      r.ok && r.input.pathId === 'villa' && [r.input.office, r.input.bedroomConsistency],
    ).toEqual([false, false]);
    const on = buildInput('villa', { ...base, office: true, bedroomConsistency: true });
    expect(
      on.ok && on.input.pathId === 'villa' && [on.input.office, on.input.bedroomConsistency],
    ).toEqual([true, true]);
  });
});

describe('individual product', () => {
  it('sends no branch unless one was chosen', () => {
    const r = finalInput('individualProduct', {
      productType: 'Sofa',
      style: 'modern',
      colour: 'grey',
    });
    expect(r.ok && r.input.pathId === 'individualProduct' && r.input.branch).toBe(null);
    const withBranch = finalInput('individualProduct', {
      productType: 'Sofa',
      branch: '3',
      style: 'modern',
      colour: 'grey',
    });
    expect(
      withBranch.ok && withBranch.input.pathId === 'individualProduct' && withBranch.input.branch,
    ).toBe('3');
  });
});
