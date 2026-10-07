// E-mail addresses that a person types or pastes and that are then sent to the server as recipients.
// Everything here is pure and linear in the input size: no pattern has a nested quantifier that can
// match the same characters two ways, and lengths are checked before any pattern runs.

/** RFC 5321 limits: 64 characters before the "@", 255 for the domain, 254 for the whole address. */
export const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL = 64;
const MAX_LABEL = 63;

/**
 * ASCII only, on purpose. The addresses are shown to the person in a confirmation dialog before
 * invitations leave, and a Cyrillic "а" in a domain looks like a Latin "a": a look-alike address
 * would pass for a colleague's. Letters, digits and the characters RFC 5322 allows in a local part.
 */
const LOCAL_ATOM = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+$/;
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const HAS_LETTER = /[A-Za-z]/;

/**
 * A plain `local@domain` address: no display name, no quotes, no comments, no spaces, no control or
 * bidi characters and no letters outside ASCII. The domain needs a dot and a non-numeric last
 * label, so `a@b`, `a@1.2.3.4` and `a@[::1]` are refused.
 */
export function isEmail(v: unknown): v is string {
  if (typeof v !== 'string' || v.length < 3 || v.length > MAX_EMAIL_LENGTH) return false;
  const at = v.lastIndexOf('@');
  if (at < 1 || at !== v.indexOf('@')) return false; // exactly one "@", not first
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  if (local.length > MAX_LOCAL || !domain.includes('.')) return false;
  if (!local.split('.').every((atom) => atom.length > 0 && LOCAL_ATOM.test(atom))) return false; // no leading, trailing or doubled dots
  const labels = domain.split('.');
  if (!labels.every((l) => l.length > 0 && l.length <= MAX_LABEL && LABEL.test(l))) return false;
  return HAS_LETTER.test(labels[labels.length - 1]);
}

/** Case-insensitive identity of an address: `Ivan@X.ru` and `ivan@x.ru` are the same recipient. */
export const emailKey = (e: string): string => e.toLowerCase();

/** Removes repeats, case-insensitively, keeping the first spelling and the order. */
export function dedupeEmails(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of list) {
    const k = emailKey(e);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(e);
    }
  }
  return out;
}

const MAX_PASTE = 20_000;
const MAX_TOKENS = 1000;
/** Tokens are split on whitespace and list separators; brackets and quotes around an address are shed. */
const SEPARATORS = /[\s;,]+/;
const LEADING = '<("\'«“';
const TRAILING = '>)"\'»”.:';

/** Shed brackets and quotes around a token with two index walks: a pattern that anchors at the end would rescan a long run of dots from every position. */
function stripEdges(token: string): string {
  let a = 0;
  let b = token.length;
  while (a < b && LEADING.includes(token[a])) a++;
  while (b > a && TRAILING.includes(token[b - 1])) b--;
  return token.slice(a, b);
}

const valid = (s: string): boolean => isEmail(s);

export interface ParsedAddresses {
  /** Valid addresses, in order, without repeats. */
  addresses: string[];
  /** Tokens that look like addresses (they contain an "@") but are not valid. */
  invalid: string[];
  /** Whether anything other than separators was there: tells "nothing typed" from "typed, but not an address". */
  hadText: boolean;
}

/**
 * Reads a comma, semicolon, space or line separated list, also in the form Outlook copies
 * (`Иван Иванов <ivan@example.com>; Пётр <petr@example.com>`): names are ignored, only addresses are kept.
 */
export function parseAddressList(text: string): ParsedAddresses {
  const addresses: string[] = [];
  const invalid: string[] = [];
  const raw = text.length > MAX_PASTE ? text.slice(0, MAX_PASTE) : text;
  const tokens = raw.split(SEPARATORS).slice(0, MAX_TOKENS);
  let hadText = false;
  for (const token of tokens) {
    const t = stripEdges(token).replace(/^mailto:/i, '');
    if (!t) continue;
    hadText = true;
    if (valid(t)) addresses.push(t);
    else if (t.includes('@')) invalid.push(t.length > 80 ? `${t.slice(0, 80)}…` : t);
  }
  return { addresses: dedupeEmails(addresses), invalid, hadText };
}

// ---------- For callers that want the list in one spelling, with a cap ----------

/** Trimmed and lower case: the one spelling used to compare addresses and to send them. */
export const normalizeEmail = (v: string): string => v.trim().toLowerCase();

export interface ParsedEmails {
  /** Valid, lower case, without duplicates, at most `max`. */
  valid: string[];
  /** Pieces that look like an address attempt but are not valid (shortened, for a message). */
  invalid: string[];
  /** Valid addresses beyond `max` that were left out. */
  overflow: number;
}

/** `parseAddressList`, with the addresses already on the list left out and the rest cut at `max`. */
export function parseEmailList(text: string, max: number, already: readonly string[] = []): ParsedEmails {
  const parsed = parseAddressList(text);
  const seen = new Set(already.map(normalizeEmail));
  const valid: string[] = [];
  let overflow = 0;
  for (const a of parsed.addresses) {
    const key = normalizeEmail(a);
    if (seen.has(key)) continue;
    seen.add(key);
    if (valid.length >= max) overflow += 1;
    else valid.push(key);
  }
  return { valid, invalid: parsed.invalid.slice(0, 5), overflow };
}
