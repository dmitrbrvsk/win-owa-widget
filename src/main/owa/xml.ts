// A small forward-only XML tokenizer for the few EWS answers we read (CreateItem, ResolveNames).
// An answer is the server's to write, so nothing here may take more than linear time on hostile
// input: every scan moves forward with `indexOf`, a tag that never closes ends the scan, and tag and
// text sizes are capped. It does not validate; consumers read only the fields they need and check them.
//
// No DOM parser is used on purpose: no entity expansion beyond the five predefined ones and numeric
// references (a "billion laughs" DOCTYPE is skipped, never expanded), and no external references.

export type XmlToken =
  | { t: 'open'; /** local name, without the namespace prefix */ name: string; /** raw text between the name and ">" */ attrs: string; selfClosing: boolean }
  | { t: 'close'; name: string }
  | { t: 'text'; text: string };

const MAX_TAG = 4000;
const MAX_TEXT = 20_000;
export const MAX_TOKENS = 200_000;

const ENTITY = /&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/g;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXmlText(s: string): string {
  return s.replace(ENTITY, (m, e: string) => {
    if (e[0] !== '#') return NAMED[e];
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : m;
  });
}

const localName = (qualified: string): string => qualified.slice(qualified.lastIndexOf(':') + 1);

export function* xmlTokens(xml: string, maxTokens = MAX_TOKENS): Generator<XmlToken> {
  const n = xml.length;
  let pos = 0;
  let count = 0;
  while (pos < n && count < maxTokens) {
    const lt = xml.indexOf('<', pos);
    if (lt < 0) {
      yield { t: 'text', text: decodeXmlText(xml.slice(pos, pos + MAX_TEXT)) };
      return;
    }
    if (lt > pos) {
      count++;
      yield { t: 'text', text: decodeXmlText(xml.slice(pos, Math.min(lt, pos + MAX_TEXT))) };
    }
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end < 0) return;
      pos = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end < 0) return;
      count++;
      yield { t: 'text', text: xml.slice(lt + 9, Math.min(end, lt + 9 + MAX_TEXT)) };
      pos = end + 3;
      continue;
    }
    const gt = xml.indexOf('>', lt + 1);
    if (gt < 0) return; // an unclosed tag: nothing after it can be read as one
    pos = gt + 1;
    if (xml[lt + 1] === '?' || xml[lt + 1] === '!') continue; // declaration, DOCTYPE: skipped
    if (gt - lt > MAX_TAG) continue;
    const inner = xml.slice(lt + 1, gt);
    count++;
    if (inner[0] === '/') {
      yield { t: 'close', name: localName(inner.slice(1).trim().split(/\s/, 1)[0]) };
      continue;
    }
    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const space = body.search(/\s/);
    const qualified = space < 0 ? body : body.slice(0, space);
    if (!qualified) continue;
    yield { t: 'open', name: localName(qualified), attrs: space < 0 ? '' : body.slice(space + 1), selfClosing };
  }
}

/** The value of `name="…"` (or single-quoted) in the raw attribute text of a tag. */
export function xmlAttr(attrs: string, name: string): string | undefined {
  // The attribute text of one tag is at most MAX_TAG characters, so this scan is bounded.
  const m = new RegExp(`(?:^|\\s)(?:[\\w.-]{1,32}:)?${name}\\s{0,8}=\\s{0,8}(?:"([^"]{0,2000})"|'([^']{0,2000})')`).exec(attrs);
  return m ? decodeXmlText(m[1] ?? m[2]) : undefined;
}
