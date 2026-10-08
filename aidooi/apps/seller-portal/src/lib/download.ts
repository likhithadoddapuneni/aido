import { problemFrom, type Api } from '@aidooi/api-client';
import { authorizationHeader } from '@aidooi/api-client';

/**
 * Fetch a file the API serves behind authentication (CSV exports, the import template) and hand it to
 * the browser as a download. A plain link cannot be used: it would not carry the bearer token.
 */
export async function downloadFile(api: Api, path: string, filename: string): Promise<void> {
  const session = await api.session();
  const res = await fetch(path, {
    headers: session ? { authorization: authorizationHeader(session) } : {},
  });
  if (!res.ok) throw await problemFrom(res);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
