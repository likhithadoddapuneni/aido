import { ApiProblem, NetworkError } from '@aidooi/api-client';
import { errorMessage, type Locale } from '@aidooi/i18n';

/** Codes this app can raise that the shared catalogue does not know yet (they come from the viewing module). */
const LOCAL: Record<Locale, Readonly<Record<string, string>>> = {
  en: {
    pass_expired: 'This pass has expired.',
    pass_not_yet_valid: 'This pass is not valid yet.',
  },
  ar: {
    pass_expired: 'انتهت صلاحية هذا التصريح.',
    pass_not_yet_valid: 'هذا التصريح غير صالح بعد.',
  },
};

/**
 * What to tell a person about a failure. A server problem gets its translated message; a dropped
 * connection says so; anything else is the generic apology. Never a raw code, never a stack.
 */
export function messageFor(error: unknown, locale: Locale): string {
  if (error instanceof ApiProblem)
    return LOCAL[locale][error.code] ?? errorMessage(error.code, locale);
  if (error instanceof NetworkError)
    return locale === 'ar'
      ? 'تعذّر الاتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى.'
      : 'Could not reach the server. Check your connection and try again.';
  return errorMessage('internal_error', locale);
}
