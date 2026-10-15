import type { UpdateCheckResult } from './types';
export const RELEASES_API = 'https://api.github.com/repos/dmitrbrvsk/win-owa-widget/releases/latest';
export const RELEASES_PAGE = 'https://github.com/dmitrbrvsk/win-owa-widget/releases';
const VERSION = /^v?(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
export function releaseInfo(raw: unknown, current: string): { result: UpdateCheckResult; url: string } {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || r.draft !== false || r.prerelease !== false || typeof r.tag_name !== 'string' || !VERSION.test(r.tag_name) || !VERSION.test(current)) throw new Error('GitHub вернул неподдерживаемый релиз');
  const latest = r.tag_name.replace(/^v/, '');
  const expected = `${RELEASES_PAGE}/tag/${r.tag_name}`;
  if (r.html_url !== expected) throw new Error('GitHub вернул неожиданную ссылку релиза');
  const a = latest.split('.').map(Number), b = current.replace(/^v/, '').split('.').map(Number);
  const first = a.findIndex((n, i) => n !== b[i]);
  return { result: { status: first >= 0 && a[first] > b[first] ? 'available' : 'current', currentVersion: current, latestVersion: latest }, url: expected };
}
