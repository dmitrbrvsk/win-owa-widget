// What the person typed as the server address → https://host (the shared check, as an OwaError).
import { checkServerUrl, serverUrlError } from '../../shared/serverUrl';
import { OwaError } from './errors';

export function parseBaseUrl(input: string): string {
  const check = checkServerUrl(input);
  if (!check.ok) throw new OwaError('other', serverUrlError(check)!);
  return check.url;
}
