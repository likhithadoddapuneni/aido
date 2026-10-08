import { HttpError } from '../http/problem.ts';
import type { MediaStorage } from '../ports.ts';

/** Until the object-storage adapter is configured, photo uploads fail loudly instead of pretending to work. */
export const unconfiguredMedia: MediaStorage = {
  signUpload: async () => {
    throw new HttpError(
      503,
      'media_storage_not_configured',
      'Photo uploads are not available yet.',
    );
  },
  head: async () => null,
};
