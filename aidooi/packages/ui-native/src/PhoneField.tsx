import { Field, type FieldProps } from './Field.tsx';
import { useStrings } from './locale.tsx';
import { normaliseUaeMobile } from './phone.ts';

export interface PhoneFieldProps extends Omit<
  FieldProps,
  'keyboardType' | 'onChangeText' | 'onChange' | 'value' | 'label' | 'error'
> {
  value: string;
  /** Called on every edit with the raw text and its E.164 form (null until it is a valid UAE mobile). */
  onChange: (raw: string, e164: string | null) => void;
  label?: string;
  /** Show the validity message (usually after the first blur or a submit attempt). */
  showError?: boolean;
}

export function PhoneField({
  value,
  onChange,
  label,
  showError = false,
  ...rest
}: PhoneFieldProps) {
  const s = useStrings();
  const invalid = value.trim().length > 0 && normaliseUaeMobile(value) === null;
  return (
    <Field
      label={label ?? s('phoneLabel')}
      value={value}
      onChangeText={(raw) => onChange(raw, normaliseUaeMobile(raw))}
      keyboardType="phone-pad"
      textContentType="telephoneNumber"
      autoComplete="tel"
      placeholder="+971 50 123 4567"
      error={showError && invalid ? s('phoneInvalid') : undefined}
      {...rest}
    />
  );
}
