// JSON / SOAP payloads for OWA's service.svc and EWS. Port of OWARequestPayloads.swift.
// WCF needs "__type" to be the first key of every object; JS keeps insertion order, so each
// literal below lists "__type" first.
import type { RsvpAction } from '../../shared/types';
import { xmlAttr, xmlTokens } from './xml';

export interface FolderIdentifier {
  id: string;
  changeKey?: string;
}

function header(timezoneId: string) {
  return {
    __type: 'JsonRequestHeaders:#Exchange',
    RequestServerVersion: 'V2017_08_18',
    TimeZoneContext: {
      __type: 'TimeZoneContext:#Exchange',
      TimeZoneDefinition: { __type: 'TimeZoneDefinitionType:#Exchange', Id: timezoneId },
    },
  };
}

/** Local wall-clock time without offset, as the OWA web client sends it. */
export function owaLocalDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function calendarViewPayload(start: Date, end: Date, timezoneId: string, folder?: FolderIdentifier) {
  const baseFolderId = folder
    ? { __type: 'FolderId:#Exchange', Id: folder.id, ...(folder.changeKey ? { ChangeKey: folder.changeKey } : {}) }
    : { __type: 'DistinguishedFolderId:#Exchange', Id: 'calendar' };
  return {
    __type: 'GetCalendarViewJsonRequest:#Exchange',
    Header: header(timezoneId),
    Body: {
      __type: 'GetCalendarViewRequest:#Exchange',
      CalendarId: { __type: 'TargetFolderId:#Exchange', BaseFolderId: baseFolderId },
      RangeStart: owaLocalDate(start),
      RangeEnd: owaLocalDate(end),
    },
  };
}

export function calendarEventPayload(itemId: string, changeKey: string | undefined, timezoneId: string) {
  return {
    __type: 'GetCalendarEventJsonRequest:#Exchange',
    Header: header(timezoneId),
    Body: {
      __type: 'GetCalendarEventRequest:#Exchange',
      EventIds: [{ __type: 'ItemId:#Exchange', Id: itemId, ...(changeKey ? { ChangeKey: changeKey } : {}) }],
      ItemShape: {
        __type: 'ItemResponseShape:#Exchange',
        BaseShape: 'IdOnly',
        FilterHtmlContent: true,
        BlockExternalImagesIfSenderUntrusted: true,
        BlockContentFromUnknownSenders: false,
        AddBlankTargetToLinks: true,
        ClientSupportsIrm: true,
        FilterInlineSafetyTips: true,
        MaximumBodySize: 0,
        BodyType: 'HTML',
      },
    },
  };
}

export function escapeXml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function rsvpElementName(action: RsvpAction): string {
  return action === 'accept' ? 'AcceptItem' : action === 'tentative' ? 'TentativelyAcceptItem' : 'DeclineItem';
}

export function rsvpSoap(itemId: string, changeKey: string | undefined, action: RsvpAction): string {
  const el = rsvpElementName(action);
  const ck = changeKey ? ` ChangeKey="${escapeXml(changeKey)}"` : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
  <soap:Header>
    <t:RequestServerVersion Version="Exchange2013_SP1"/>
  </soap:Header>
  <soap:Body>
    <m:CreateItem MessageDisposition="SendAndSaveCopy">
      <m:Items>
        <t:${el}>
          <t:ReferenceItemId Id="${escapeXml(itemId)}"${ck}/>
        </t:${el}>
      </m:Items>
    </m:CreateItem>
  </soap:Body>
</soap:Envelope>`;
}

/** Version conflicts: answer the current version instead of failing. */
export function isStaleChangeKeyCode(code: string): boolean {
  return code === 'ErrorIrresolvableConflict' || code === 'ErrorStaleObject';
}

/** A ResponseCode is an identifier such as `ErrorAccessDenied`; anything else from the server is not repeated anywhere. */
const CODE = /^[A-Za-z][A-Za-z0-9]{2,80}$/;

export type RsvpOutcome = { ok: true } | { ok: false; code?: string };

/**
 * Reads the answer to an RSVP: the first `…ResponseMessage` element's ResponseClass and the first
 * ResponseCode. The namespace prefix is the server's to choose (`m:`, `messages:`, none at all), so
 * the answer is tokenized instead of matched as text — a prefix we did not expect used to read as
 * "no code", and the person was told the organizer had been answered.
 *
 * Success needs an explicit `ResponseClass="Success"` and a code that is absent or `NoError`: an
 * error class, an unknown code, an HTML error page or an empty body are all "not answered".
 */
export function parseRsvpResponse(xml: string): RsvpOutcome {
  let responseClass: string | undefined;
  /** An element was there: a code we could not read must not pass for an absent one. */
  let sawCode = false;
  let code: string | undefined;
  let wantCode = false;
  for (const tok of xmlTokens(xml)) {
    if (tok.t === 'open') {
      if (responseClass === undefined && tok.name.endsWith('ResponseMessage')) responseClass = xmlAttr(tok.attrs, 'ResponseClass');
      else if (tok.name === 'ResponseCode' && !sawCode) {
        sawCode = true;
        wantCode = !tok.selfClosing;
      }
    } else if (tok.t === 'text' && wantCode) {
      const text = tok.text.trim();
      if (CODE.test(text)) code = text;
      wantCode = false;
      if (responseClass !== undefined) break;
    } else if (tok.t === 'close' && tok.name === 'ResponseCode') wantCode = false;
  }
  if (responseClass === 'Success' && (!sawCode || code === 'NoError')) return { ok: true };
  return { ok: false, code };
}

/** A message for the person, built only from what we know: never the server's own text. */
export function rsvpFailureText(code: string | undefined): string {
  if (code) return `Exchange: ${code}`;
  return 'Exchange не подтвердил ответ на приглашение — организатор мог его не получить. Проверьте встречу в календаре';
}

/** Percent-encoding OWA expects in X-OWA-UrlPostData: only A–Z a–z 0–9 - . _ ~ stay literal. */
export function formEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
