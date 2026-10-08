import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ADDRESS_EMIRATES, DeliverySchema } from '@aidooi/contracts';
import { Chip, Field, PhoneField, Text, normaliseUaeMobile, useTheme } from '@aidooi/ui-native';
import { ChoiceChips } from '../../components/index.tsx';
import { useTx } from '../../i18n/useTx.ts';
import type { Address, Delivery } from './services.ts';

export interface DeliveryDraft {
  recipientName: string;
  phone: string;
  line1: string;
  line2: string;
  area: string;
  emirate: string;
  instructions: string;
}

export const emptyDraft: DeliveryDraft = {
  recipientName: '',
  phone: '',
  line1: '',
  line2: '',
  area: '',
  emirate: '',
  instructions: '',
};

export type DeliveryErrors = Partial<Record<keyof DeliveryDraft, string>>;

/**
 * Turn what was typed into the contract's `Delivery`, or say which fields are wrong. The phone is
 * normalised to E.164 from the UAE formats people actually type; everything else is checked by the very
 * schema the server uses.
 */
export function parseDelivery(
  d: DeliveryDraft,
): { ok: true; value: Delivery } | { ok: false; errors: DeliveryErrors } {
  const phone = normaliseUaeMobile(d.phone);
  const parsed = DeliverySchema.safeParse({
    recipientName: d.recipientName.trim(),
    phone: phone ?? d.phone.trim(),
    line1: d.line1.trim(),
    ...(d.line2.trim() ? { line2: d.line2.trim() } : {}),
    ...(d.area.trim() ? { area: d.area.trim() } : {}),
    emirate: d.emirate,
    ...(d.instructions.trim() ? { instructions: d.instructions.trim() } : {}),
  });
  if (parsed.success) return { ok: true, value: parsed.data };
  const errors: DeliveryErrors = {};
  for (const issue of parsed.error.issues) {
    const k = issue.path[0] as keyof DeliveryDraft | undefined;
    if (k && !errors[k]) errors[k] = 'invalid';
  }
  return { ok: false, errors };
}

export const draftFromAddress = (a: Address, base: DeliveryDraft): DeliveryDraft => ({
  ...base,
  line1: a.line1,
  line2: a.line2 ?? '',
  area: a.area ?? '',
  emirate: a.emirate,
});

/** The delivery details for an order: saved addresses to start from, and the fields to confirm them. */
export function DeliveryForm({
  value,
  onChange,
  errors,
  saved,
}: {
  value: DeliveryDraft;
  onChange: (next: DeliveryDraft) => void;
  errors: DeliveryErrors;
  saved: readonly Address[];
}) {
  const t = useTx();
  const { space } = useTheme();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const set = <K extends keyof DeliveryDraft>(k: K, v: DeliveryDraft[K]) =>
    onChange({ ...value, [k]: v });
  useEffect(() => setPickedId(null), [saved.length]);
  const err = (k: keyof DeliveryDraft) => (errors[k] ? t('error.invalid') : undefined);

  return (
    <View style={{ gap: space[3] }}>
      {saved.length > 0 ? (
        <View style={{ gap: space[2] }}>
          <Text variant="label">{t('delivery.saved')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {saved.map((a) => (
              <Chip
                key={a.id}
                label={a.label || a.line1}
                selected={pickedId === a.id}
                onPress={() => {
                  setPickedId(a.id);
                  onChange(draftFromAddress(a, value));
                }}
              />
            ))}
          </View>
        </View>
      ) : null}
      <Field
        label={t('delivery.name')}
        value={value.recipientName}
        onChangeText={(v) => set('recipientName', v)}
        error={err('recipientName')}
        autoComplete="name"
        textContentType="name"
      />
      <PhoneField
        label={t('delivery.phone')}
        value={value.phone}
        onChange={(raw) => set('phone', raw)}
        showError={Boolean(errors.phone)}
      />
      <Field
        label={t('delivery.line1')}
        value={value.line1}
        onChangeText={(v) => set('line1', v)}
        error={err('line1')}
        autoComplete="street-address"
      />
      <Field
        label={t('delivery.line2')}
        value={value.line2}
        onChangeText={(v) => set('line2', v)}
      />
      <Field label={t('delivery.area')} value={value.area} onChangeText={(v) => set('area', v)} />
      <ChoiceChips
        label={t('delivery.emirate')}
        value={value.emirate || undefined}
        onChange={(v) => set('emirate', v)}
        options={ADDRESS_EMIRATES.map((e) => ({ value: e, label: t(`emirate.${e}` as never) }))}
        error={err('emirate')}
      />
      <Field
        label={t('delivery.instructions')}
        value={value.instructions}
        onChangeText={(v) => set('instructions', v)}
        multiline
        hint={t('delivery.instructionsHint')}
      />
    </View>
  );
}
