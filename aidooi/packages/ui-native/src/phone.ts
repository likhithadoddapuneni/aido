/**
 * UAE mobile numbers → E.164, the only form the API accepts. Accepts what people actually type:
 * `050 123 4567`, `0501234567`, `+971 50 123 4567`, `00971501234567`, `501234567`, and Arabic-Indic digits.
 * Returns null when it cannot be a UAE mobile (05x with 9 national digits, x ∈ 0,2,4,5,6,8).
 */
const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EXT_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

export function toLatinDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => {
    const i = ARABIC_INDIC.indexOf(d);
    return String(i >= 0 ? i : EXT_ARABIC_INDIC.indexOf(d));
  });
}

export function normaliseUaeMobile(input: string): string | null {
  let digits = toLatinDigits(input).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  digits = digits.replace(/\D/g, '');
  if (digits.startsWith('971')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  return /^5[024568]\d{7}$/.test(digits) ? `+971${digits}` : null;
}

/** Keep only digits, in Latin form, capped at `length`: what an OTP box may hold. Handles paste and autofill. */
export function sanitiseOtp(input: string, length: number): string {
  return toLatinDigits(input).replace(/\D/g, '').slice(0, length);
}
