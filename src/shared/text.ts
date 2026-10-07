// Text that comes from outside (a stranger's invite, a server's page, a certificate) is cleaned
// before it is shown, logged or compared. Pure functions, shared by the main process and the UI.

/**
 * Characters a reader cannot see but that change what the text means:
 *  - C0/C1 controls (tab, line feed and carriage return are kept);
 *  - the bidi overrides and isolates (U+202A–202E, U+2066–2069) that reorder what is shown;
 *  - the bidi *marks* (U+200E, U+200F, U+061C), which reorder neighbouring digits and punctuation
 *    just as well, and are what a title like "Перевод 5000 ₽" needs to read as another amount;
 *  - the zero-width and invisible characters (U+200B–U+200D, U+00AD, U+180E, U+2060, U+FEFF), with
 *    which a title can be padded until the part a person reads is empty while the rest is still sent.
 */
// eslint-disable-next-line no-control-regex
const HIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f­؜᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

export function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

/** Drops invisible control characters but keeps line breaks, then cuts to `max` characters. */
export function clean(s: string, max: number): string {
  return clip(s, max).replace(HIDDEN, '');
}

/** One line, no control characters, single spaces: for log lines, dialogs and messages built from foreign text. */
export function oneLine(s: string, max = 200): string {
  return clean(s, max * 2)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** True when the text carries hidden control or bidi characters (a link that reads differently from what it is). */
export function hasHiddenChars(s: string): boolean {
  return new RegExp(HIDDEN.source).test(s);
}

/** One log entry, one line: text from a server or a certificate cannot add lines of its own to the log. */
export function logLine(message: string): string {
  return clean(message, 2000).replace(/\r?\n/g, ' ⏎ ').replace(/[\r\t]/g, ' ');
}
