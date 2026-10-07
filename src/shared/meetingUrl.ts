// Finds a Teams / Zoom / Webex / Google Meet / KTalk join link in free text or HTML.
// Port of MeetingURLDetector.swift.
import type { MeetingPlatform } from './types';

const END = `[^\\s<"')\\]]`;

const PATTERNS: Array<[RegExp, MeetingPlatform]> = [
  [new RegExp(`https://teams\\.microsoft\\.com/l/meetup-join/${END}+`), 'teams'],
  [new RegExp(`https://teams\\.live\\.com/meet/${END}+`), 'teams'],
  [new RegExp(`https://[a-z0-9-]+\\.zoom\\.us/j/${END}+`), 'zoom'],
  [new RegExp(`https://[a-z0-9-]+\\.webex\\.com/(?:meet|j|wc)/${END}+`), 'webex'],
  [new RegExp(`https://meet\\.google\\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}${END}*`), 'googleMeet'],
  [new RegExp(`(?:https?://)?[a-z0-9-]+\\.ktalk\\.ru(?:/${END}*)?`, 'i'), 'ktalk'],
];

const TRIM = /^[.,;"'<>)\\\]]+|[.,;"'<>)\\\]]+$/g;

/** Text from a stranger's invite: scanned only up to here, so a hostile one cannot stall the app. */
const MAX_SCAN = 20_000;
const MAX_URL = 2048;

export function stripHtml(text: string): string {
  return text.includes('<') ? text.replace(/<[^<>]*>/g, ' ') : text;
}

function normalizeEscaped(text: string): string {
  return text.replaceAll('\\/', '/').replaceAll('&amp;', '&');
}

export function detectMeetingUrl(input: string): { url: string; platform: MeetingPlatform } | null {
  const text = input.length > MAX_SCAN ? input.slice(0, MAX_SCAN) : input;
  const plain = stripHtml(text);
  const base = plain === text ? [text] : [text, plain];
  const sources = [...new Set([...base.map(normalizeEscaped), ...base])];

  for (const source of sources) {
    for (const [regex, platform] of PATTERNS) {
      const match = regex.exec(source);
      if (!match) continue;
      if (match[0].length > MAX_URL) continue;
      let url = match[0].replace(TRIM, '');
      if (platform === 'ktalk' && !/^https?:\/\//i.test(url)) url = `https://${url}`;
      if (safeUrl(url)) return { url, platform };
    }
  }
  return null;
}

/**
 * Platform of a link that is already a whole URL. A known name hiding inside another site's URL
 * (`https://evil.example/?next=https://a.zoom.us/j/1`) does not count: the hosts must be the same.
 */
export function detectPlatform(url: string): MeetingPlatform {
  const found = detectMeetingUrl(url);
  if (!found) return 'generic';
  try {
    return new URL(found.url).host.toLowerCase() === new URL(url).host.toLowerCase() ? found.platform : 'generic';
  } catch {
    return 'generic';
  }
}

/** Host of a link, for showing where a Join button really goes. */
export function urlHost(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/** Only http(s) links are ever opened; file:// and custom schemes are dropped. */
export function safeUrl(raw: string | undefined | null): string | null {
  if (!raw || raw.length > MAX_URL) return null;
  let candidate = raw.trim();
  if (!candidate) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) candidate = `https://${candidate}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null; // https://trusted.example@evil.example/ looks right and is not
    if (!u.hostname) return null;
    return u.toString();
  } catch {
    return null;
  }
}
