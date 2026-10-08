import { unwrap } from '@aidooi/api-client';
import { useApi, useAuth } from '@aidooi/ui-web';
import { useQuery } from '@tanstack/react-query';
import { isRole, type Role } from './permissions.ts';

export interface SellerMe {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly role: Role;
  readonly partnerId: string;
  readonly locationId: string | null;
}

/** Who is signed in, from the server (the role is never trusted from the client). */
export function useMe() {
  const api = useApi();
  const { signedIn } = useAuth();
  return useQuery({
    queryKey: ['me'],
    enabled: signedIn,
    staleTime: 60_000,
    queryFn: async (): Promise<SellerMe> => {
      const me = await unwrap(api.http.GET('/v1/me'));
      if (me.kind !== 'seller' || !isRole(me.role)) {
        // A buyer or ops token has no business here.
        throw Object.assign(new Error('not a seller'), { notSeller: true });
      }
      return { ...me, role: me.role };
    },
  });
}
