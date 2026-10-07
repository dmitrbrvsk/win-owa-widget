// JSON / SOAP payloads for OWA's service.svc and EWS. Port of OWARequestPayloads.swift.
// WCF needs "__type" to be the first key of every object; JS keeps insertion order, so each
// literal below lists "__type" first.
import type { RsvpAction } from '../../shared/types';

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

export function extractEwsResponseCode(body: string): string | undefined {
  return /<m:ResponseCode>([^<]+)<\/m:ResponseCode>/.exec(body)?.[1];
}

/** Percent-encoding OWA expects in X-OWA-UrlPostData: only A–Z a–z 0–9 - . _ ~ stay literal. */
export function formEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
