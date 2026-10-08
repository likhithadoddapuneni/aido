import { COLOUR_IDS, STYLE_IDS } from '@aidooi/contracts';
import { MATERIAL_FAMILIES, PRODUCT_TYPES, branchesOf } from '@aidooi/domain';
import { Field, Input, Select } from '@aidooi/ui-web';
import { useS } from '../i18n/index.tsx';

/** What the seller types for a product; numbers stay strings until submit so a half-typed value is not lost. */
export interface ProductDraft {
  name: string;
  type: string;
  widthCm: string;
  depthCm: string;
  heightCm: string;
  primaryColour: string;
  secondaryColour: string;
  primaryStyle: string;
  secondaryStyle: string;
  material: string;
  attribute: string;
}

export const emptyDraft = (): ProductDraft => ({
  name: '',
  type: '',
  widthCm: '',
  depthCm: '',
  heightCm: '',
  primaryColour: '',
  secondaryColour: '',
  primaryStyle: '',
  secondaryStyle: '',
  material: '',
  attribute: '',
});

/** The practical attribute a type needs, and how it is named in the contract. */
export function attributeOf(
  type: string,
): { key: string; kind: 'choice' | 'number' | 'bool'; options: readonly string[] } | null {
  switch (type) {
    case 'Sofa':
      return { key: 'seats', kind: 'choice', options: branchesOf('Sofa') };
    case 'Bed':
      return { key: 'bedSize', kind: 'choice', options: branchesOf('Bed') };
    case 'Dining Table':
      return { key: 'capacity', kind: 'choice', options: branchesOf('Dining Table') };
    case 'Wardrobe':
      return { key: 'doorGroup', kind: 'choice', options: branchesOf('Wardrobe') };
    case 'Rug':
      return { key: 'rugSize', kind: 'choice', options: branchesOf('Rug') };
    case 'Office Chair':
      return { key: 'adjustable', kind: 'bool', options: ['true', 'false'] };
    case 'Desk':
      return { key: 'cableManagement', kind: 'bool', options: ['true', 'false'] };
    default:
      return null;
  }
}

const num = (v: string): number | undefined => {
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) ? n : undefined;
};

/** The request body for a draft: only filled fields are sent, so "missing" is reported by the server. */
export function draftToBody(
  d: ProductDraft,
  opts: { partial?: boolean } = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (d.name.trim()) body['name'] = d.name.trim();
  if (d.type) body['type'] = d.type;
  for (const k of ['widthCm', 'depthCm', 'heightCm'] as const) {
    const n = num(d[k]);
    if (n !== undefined) body[k] = n;
    else if (d[k].trim() !== '') body[k] = Number.NaN; // present but not a number: let the server say so
  }
  if (d.primaryColour) body['primaryColour'] = d.primaryColour;
  // When editing, a blank secondary means "not touched" (the API does not return them); when creating it means none.
  if (!opts.partial || d.secondaryColour) body['secondaryColour'] = d.secondaryColour || null;
  if (d.primaryStyle) body['primaryStyle'] = d.primaryStyle;
  if (!opts.partial || d.secondaryStyle) body['secondaryStyle'] = d.secondaryStyle || null;
  if (d.material) body['material'] = d.material;
  const attr = attributeOf(d.type);
  if (attr && d.attribute !== '') {
    const raw =
      attr.kind === 'bool'
        ? d.attribute === 'true'
        : attr.key === 'seats' || attr.key === 'capacity'
          ? Number(d.attribute)
          : d.attribute;
    body['attributes'] = { [attr.key]: raw };
  }
  return body;
}

export function ProductForm({
  value,
  onChange,
  errors,
  prefix = '',
}: {
  value: ProductDraft;
  onChange: (next: ProductDraft) => void;
  errors: (path: string) => string | undefined;
  /** Server paths are prefixed (`newProduct.`) when nested in an offer request. */
  prefix?: string;
}) {
  const s = useS();
  const set = (k: keyof ProductDraft, v: string) =>
    onChange({ ...value, [k]: v, ...(k === 'type' ? { attribute: '' } : {}) });
  const attr = attributeOf(value.type);
  const e = (p: string) => errors(`${prefix}${p}`);
  const colourOptions = (blank: string) => (
    <>
      <option value="">{blank}</option>
      {COLOUR_IDS.map((c) => (
        <option key={c} value={c}>
          {s.colours[c]}
        </option>
      ))}
    </>
  );
  const styleOptions = (blank: string) => (
    <>
      <option value="">{blank}</option>
      {STYLE_IDS.map((c) => (
        <option key={c} value={c}>
          {s.styles[c]}
        </option>
      ))}
    </>
  );
  return (
    <>
      <Field id={`${prefix}name`} label={s.productName} hint={s.productNameHint} error={e('name')}>
        <Input value={value.name} onChange={(ev) => set('name', ev.target.value)} />
      </Field>
      <Field id={`${prefix}type`} label={s.productType} error={e('type')}>
        <Select value={value.type} onChange={(ev) => set('type', ev.target.value)}>
          <option value="">{s.choose}</option>
          {PRODUCT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </Field>
      {attr && (
        <Field
          id={`${prefix}attributes.${attr.key}`}
          label={s.attributeLabels[attr.key] ?? attr.key}
          error={e(`attributes.${attr.key}`) ?? e('attributes')}
        >
          <Select value={value.attribute} onChange={(ev) => set('attribute', ev.target.value)}>
            <option value="">{s.choose}</option>
            {attr.options.map((o) => (
              <option key={o} value={o}>
                {attr.kind === 'bool' ? (o === 'true' ? s.yes : s.no) : o}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="portal-row">
        <Field id={`${prefix}widthCm`} label={s.widthCm} error={e('widthCm')}>
          <Input
            inputMode="decimal"
            value={value.widthCm}
            onChange={(ev) => set('widthCm', ev.target.value)}
          />
        </Field>
        <Field id={`${prefix}depthCm`} label={s.depthCm} error={e('depthCm')}>
          <Input
            inputMode="decimal"
            value={value.depthCm}
            onChange={(ev) => set('depthCm', ev.target.value)}
          />
        </Field>
        <Field id={`${prefix}heightCm`} label={s.heightCm} error={e('heightCm')}>
          <Input
            inputMode="decimal"
            value={value.heightCm}
            onChange={(ev) => set('heightCm', ev.target.value)}
          />
        </Field>
      </div>
      <div className="portal-row">
        <Field id={`${prefix}primaryColour`} label={s.primaryColour} error={e('primaryColour')}>
          <Select
            value={value.primaryColour}
            onChange={(ev) => set('primaryColour', ev.target.value)}
          >
            {colourOptions(s.choose)}
          </Select>
        </Field>
        <Field
          id={`${prefix}secondaryColour`}
          label={s.secondaryColour}
          error={e('secondaryColour')}
        >
          <Select
            value={value.secondaryColour}
            onChange={(ev) => set('secondaryColour', ev.target.value)}
          >
            {colourOptions(s.none)}
          </Select>
        </Field>
      </div>
      <div className="portal-row">
        <Field id={`${prefix}primaryStyle`} label={s.primaryStyle} error={e('primaryStyle')}>
          <Select
            value={value.primaryStyle}
            onChange={(ev) => set('primaryStyle', ev.target.value)}
          >
            {styleOptions(s.choose)}
          </Select>
        </Field>
        <Field id={`${prefix}secondaryStyle`} label={s.secondaryStyle} error={e('secondaryStyle')}>
          <Select
            value={value.secondaryStyle}
            onChange={(ev) => set('secondaryStyle', ev.target.value)}
          >
            {styleOptions(s.none)}
          </Select>
        </Field>
      </div>
      <Field id={`${prefix}material`} label={s.material} error={e('material')}>
        <Select value={value.material} onChange={(ev) => set('material', ev.target.value)}>
          <option value="">{s.choose}</option>
          {MATERIAL_FAMILIES.map((m) => (
            <option key={m} value={m}>
              {s.materials[m]}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}
