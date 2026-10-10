// Finds a Teams / Zoom / Webex / Google Meet / KTalk join link in free text or HTML.
// Port of MeetingURLDetector.swift.
//
// The text comes from whoever sent the invitation, so every step is linear in its length: a
// pattern that can start at any position and then scan far ahead (a "[a-z0-9-]+" label in front of
// a fixed suffix) makes a few kilobytes of "aaaa…" cost seconds. Patterns here start with a fixed
// literal; the one without (KTalk) is found with indexOf instead of a regular expression.
import type { MeetingPlatform } from './types';
import { hasHiddenChars } from './text';

const END = `[^\\s<"')\\]]`;

const PATTERNS: Array<[RegExp, MeetingPlatform]> = [
  [new RegExp(`https://teams\\.microsoft\\.com/l/meetup-join/${END}+`), 'teams'],
  [new RegExp(`https://teams\\.live\\.com/meet/${END}+`), 'teams'],
  [new RegExp(`https://[a-z0-9-]+\\.zoom\\.us/j/${END}+`), 'zoom'],
  [new RegExp(`https://[a-z0-9-]+\\.webex\\.com/(?:meet|j|wc)/${END}+`), 'webex'],
  [new RegExp(`https://meet\\.google\\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}${END}*`), 'googleMeet'],
];

const TRIM = /^[.,;"'<>)\\\]]+|[.,;"'<>)\\\]]+$/g;

/** Text from a stranger's invite: scanned only up to here, so a hostile one cannot stall the app. */
const MAX_SCAN = 20_000;
const MAX_URL = 2048;

const KTALK = '.ktalk.ru';
const HOST_CHAR = /[a-z0-9.-]/;
const PATH_END = /[\s<"')\]]/;

/** `team.ktalk.ru/room` with or without a scheme. Walks back from ".ktalk.ru" instead of scanning forward from every position. */
function findKtalk(source: string): string | null {
  const lower = source.toLowerCase();
  let from = 0;
  for (;;) {
    const at = lower.indexOf(KTALK, from);
    if (at < 0) return null;
    from = at + 1;
    let start = at;
    // A host name is at most 253 characters: walking back further only re-reads the same text for the next match.
    while (start > 0 && at - start < 253 && HOST_CHAR.test(lower[start - 1])) start--;
    while (start < at && (lower[start] === '.' || lower[start] === '-')) start++;
    if (start === at) continue; // ".ktalk.ru" without a name in front of it
    let from0 = start;
    if (start >= 8 && lower.startsWith('https://', start - 8)) from0 = start - 8;
    else if (start >= 7 && lower.startsWith('http://', start - 7)) from0 = start - 7;
    let end = at + KTALK.length;
    const next = lower[end];
    if (next === '/') {
      end++;
      while (end < source.length && !PATH_END.test(source[end])) end++;
    } else if (next !== undefined && (/[a-z0-9-]/.test(next) || (next === '.' && /[a-z0-9-]/.test(lower[end + 1] ?? '')))) {
      continue; // ".ktalk.rus" or ".ktalk.ru.evil.example": the host goes on, it is another one
    }
    return source.slice(from0, end);
  }
}

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
    const candidates: Array<[string | null, MeetingPlatform]> = PATTERNS.map(([regex, platform]) => [regex.exec(source)?.[0] ?? null, platform]);
    candidates.push([findKtalk(source), 'ktalk']);
    for (const [found, platform] of candidates) {
      if (!found || found.length > MAX_URL) continue;
      let url = found.replace(TRIM, '');
      if (platform === 'ktalk' && !/^https?:\/\//i.test(url)) url = `https://${url}`;
      // The normalized form is what is shown and opened: no hidden characters, no surprises in the path.
      const safe = safeUrl(url);
      if (safe) return { url: safe, platform };
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

// ---------- Links inside plain text ----------

/**
 * How a bare link is picked out of plain text. One definition for both sides: the window turns these
 * into something clickable, and the main process remembers exactly the same ones as the links it
 * handed out, so the two cannot disagree about what is a link.
 */
const linkPattern = () => /(https?:\/\/[^\s<>"')]+)/g;

/** The text split into alternating plain parts and links (`isHttpLink` tells them apart). */
export function splitByLinks(text: string): string[] {
  return (text.length > MAX_SCAN ? text.slice(0, MAX_SCAN) : text).split(linkPattern());
}

export function isHttpLink(part: string): boolean {
  return /^https?:\/\//.test(part);
}

/** The links of a text, normalised and without repeats; at most `max` of them. */
export function linksInText(text: string, max = 200): string[] {
  const out: string[] = [];
  for (const part of splitByLinks(text)) {
    if (!isHttpLink(part)) continue;
    const safe = safeUrl(part);
    if (safe && !out.includes(safe)) out.push(safe);
    if (out.length >= max) break;
  }
  return out;
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
  // Control and bidi-override characters make a link read differently from where it goes.
  if (hasHiddenChars(candidate)) return null;
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
