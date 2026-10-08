import type { Session } from '@aidooi/api-client';

/** The API's token pair as the client's session. */
export const toSession = (t: { accessToken: string; refreshToken: string }): Session => ({
  kind: 'user',
  accessToken: t.accessToken,
  refreshToken: t.refreshToken,
});
