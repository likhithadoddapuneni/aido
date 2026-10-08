import type { Locale } from '@aidooi/i18n';

/**
 * The few words components themselves speak (accessibility labels, retry, loading). Product copy lives in
 * the apps; this is only what a component cannot work without, in both languages.
 */
export const builtInStrings = {
  en: {
    back: 'Back',
    retry: 'Try again',
    loading: 'Loading',
    close: 'Close',
    dismiss: 'Dismiss',
    increase: 'Increase quantity',
    decrease: 'Decrease quantity',
    quantity: 'Quantity',
    stepOf: 'Step {current} of {total}',
    codeLabel: 'Verification code',
    codeProgress: '{count} of {total} digits entered',
    phoneLabel: 'Mobile number',
    phoneInvalid: 'Enter a valid UAE mobile number.',
    concept: 'Concept',
    conceptNote: 'A measured concept plan, not a photograph.',
    planSummary: 'Room plan, {width} by {depth} centimetres, {count} items.',
    unplaced: '{count} items do not fit the plan.',
    offline: 'You appear to be offline. Check your connection and try again.',
    reference: 'Reference',
    wasPrice: 'was {price}',
  },
  ar: {
    back: 'رجوع',
    retry: 'حاول مرة أخرى',
    loading: 'جارٍ التحميل',
    close: 'إغلاق',
    dismiss: 'تجاهل',
    increase: 'زيادة الكمية',
    decrease: 'إنقاص الكمية',
    quantity: 'الكمية',
    stepOf: 'الخطوة {current} من {total}',
    codeLabel: 'رمز التحقق',
    codeProgress: 'تم إدخال {count} من {total} أرقام',
    phoneLabel: 'رقم الجوال',
    phoneInvalid: 'أدخل رقم جوال إماراتيًا صحيحًا.',
    concept: 'تصور',
    conceptNote: 'مخطط تصوري بمقاسات حقيقية وليس صورة فوتوغرافية.',
    planSummary: 'مخطط الغرفة، {width} في {depth} سنتيمتر، {count} عناصر.',
    unplaced: '{count} عناصر لا تتسع في المخطط.',
    offline: 'يبدو أنك غير متصل. تحقق من الاتصال وحاول مرة أخرى.',
    reference: 'المرجع',
    wasPrice: 'كان {price}',
  },
} as const satisfies Record<Locale, Record<string, string>>;

export type BuiltInKey = keyof (typeof builtInStrings)['en'];
