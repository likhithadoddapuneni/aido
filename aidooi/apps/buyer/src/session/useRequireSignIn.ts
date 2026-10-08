import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useServices } from '../providers/AppProviders.tsx';

/**
 * For any screen whose API call answers `registration_required`: remember where the buyer was heading,
 * send them to sign in, and sign-in returns them there. Their guest projects follow them.
 */
export function useRequireSignIn(): (intendedHref: string) => Promise<void> {
  const router = useRouter();
  const { pending } = useServices();
  return useCallback(
    async (intendedHref) => {
      await pending.save(intendedHref);
      router.push('/sign-in' as never);
    },
    [pending, router],
  );
}

export const isRegistrationRequired = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === 'registration_required';
