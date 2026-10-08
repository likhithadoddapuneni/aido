import type { MediaStorage } from '../../src/ports.ts';

/** In-memory object store: a test "uploads" by calling `put`, exactly as a client would PUT to the signed URL. */
export class FakeMediaStorage implements MediaStorage {
  readonly objects = new Map<string, { sizeBytes: number; contentType: string }>();
  readonly signed: { key: string; contentType: string; maxBytes: number; expiresAt: Date }[] = [];

  async signUpload(args: { key: string; contentType: string; maxBytes: number; expiresAt: Date }) {
    this.signed.push(args);
    return {
      url: `https://storage.test/${args.key}?sig=fake`,
      headers: { 'content-type': args.contentType },
    };
  }
  async head(key: string) {
    return this.objects.get(key) ?? null;
  }
  put(key: string, sizeBytes: number, contentType: string): void {
    this.objects.set(key, { sizeBytes, contentType });
  }
}
