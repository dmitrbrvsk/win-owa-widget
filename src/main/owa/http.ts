// HTTP on Chromium's network stack (Electron `net`): cookies, proxy settings, the Windows
// certificate store and Integrated Windows Authentication (Kerberos / NTLM) come for free.
import { net, type Session } from 'electron';
import type { CertInfo } from '../../shared/types';
import { log, safeUrlForLog } from '../log';
import { certReason, OwaError } from './errors';
export { OwaError, type OwaErrorKind } from './errors';
import { redirectRefusal, requestRefusal } from './redirect';
import { oneLine } from '../../shared/text';

/** A calendar answer is a few hundred KB; anything bigger is a broken or hostile server. */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export interface HttpResponse {
  status: number;
  url: string;
  headers: Record<string, string | string[]>;
  body: Buffer;
  text(): string;
  redirects: string[];
}

export interface HttpRequest {
  method?: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface CredentialPolicy {
  /** The only host that may receive an NTLM / Negotiate / Basic answer. */
  host: string;
  port: number;
  /** `host[:port]` of the configured server: the only place a request, a redirect or a login form may lead. */
  origin: string;
  username?: string;
  password?: string;
}

/** Shared state the session's certificate hook writes and requests read. */
export interface CertState {
  lastUntrusted?: CertInfo;
}

export function sendRequest(ses: Session, req: HttpRequest, creds: CredentialPolicy, cert: CertState): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    // Every request, not only a redirect, stays on the configured https origin: a login form that
    // names http:// or another port must not get the password.
    const refused = requestRefusal(req.url, creds.origin);
    if (refused) {
      log.warn(`${req.method ?? 'GET'} ${safeUrlForLog(req.url)}: refused (${refused})`);
      reject(new OwaError('loginHost', refused));
      return;
    }
    const redirects: string[] = [];
    let currentUrl = req.url;
    let loginAttempts = 0;
    let authRejected = false;
    let foreignAuthHost: string | undefined;
    let settled = false;

    const method = req.method ?? 'GET';
    const tag = `${method} ${safeUrlForLog(req.url)}`;
    const request = net.request({
      method,
      url: req.url,
      session: ses,
      useSessionCookies: true,
      redirect: 'manual',
    });

    for (const [k, v] of Object.entries(req.headers ?? {})) request.setHeader(k, v);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      request.abort();
      reject(new OwaError('network', 'Сервер не ответил вовремя'));
    }, req.timeoutMs ?? 30_000);

    const fail = (e: OwaError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    };

    request.on('redirect', (status, _method, redirectUrl) => {
      // A 307/308 would re-send the POST body (it carries the password on forms login), and custom
      // headers such as the CANARY follow the request: never leave the configured host or HTTPS.
      const refusal = redirectRefusal(redirectUrl, creds.origin);
      if (refusal) {
        log.warn(`${tag}: redirect refused → ${safeUrlForLog(redirectUrl)}`);
        fail(new OwaError('loginHost', refusal));
        request.abort();
        return;
      }
      log.info(`${tag}: ${status} → ${safeUrlForLog(redirectUrl)}`);
      redirects.push(redirectUrl);
      currentUrl = redirectUrl;
      request.followRedirect();
    });

    request.on('login', (authInfo, callback) => {
      if (authInfo.isProxy) {
        callback();
        return;
      }
      loginAttempts += 1;
      const hostOk = authInfo.host.toLowerCase() === creds.host.toLowerCase() && authInfo.port === creds.port;
      log.info(`${tag}: ${authInfo.scheme} challenge from ${oneLine(authInfo.host, 100)}:${authInfo.port}${hostOk ? '' : ' (foreign host, no credentials)'}${creds.username ? '' : ' (no stored login)'}`);
      if (!hostOk) {
        // Never hand the domain password to a host other than the configured server.
        foreignAuthHost = oneLine(`${authInfo.host}:${authInfo.port}`, 120);
        callback();
        return;
      }
      if (!creds.username || !creds.password || loginAttempts > 1) {
        authRejected = loginAttempts > 1 || !!creds.username;
        callback();
        return;
      }
      callback(creds.username, creds.password);
    });

    request.on('response', (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_RESPONSE_BYTES) {
          log.warn(`${tag}: response over ${MAX_RESPONSE_BYTES} bytes, aborted`);
          fail(new OwaError('server', 'Сервер прислал слишком большой ответ'));
          request.abort();
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        log.info(`${tag}: HTTP ${res.statusCode}${redirects.length ? ` after ${redirects.length} redirect(s)` : ''}, ${size} bytes`);
        if (res.statusCode === 401 && foreignAuthHost) {
          reject(new OwaError('loginHost', `Сервер просит пароль для чужого хоста ${foreignAuthHost}`));
          return;
        }
        if (res.statusCode === 401 && authRejected) {
          reject(new OwaError('auth', 'Exchange не принял логин или пароль', 401));
          return;
        }
        const body = Buffer.concat(chunks);
        // The same answer is read as text several times (the login path alone reads it three times):
        // decoded once, so a big body does not cost one more copy in the main process per call.
        let text: string | undefined;
        resolve({
          status: res.statusCode,
          url: currentUrl,
          headers: res.headers,
          body,
          text: () => (text ??= body.toString('utf8')),
          redirects,
        });
      });
      res.on('error', () => fail(new OwaError('network', 'Соединение прервано')));
    });

    request.on('error', (err) => {
      const msg = String(err?.message ?? err);
      log.warn(`${tag}: ${msg}`);
      if (/ERR_CERT_|ERR_SSL_|ERR_BAD_SSL/i.test(msg)) {
        const untrusted = cert.lastUntrusted;
        const text = untrusted
          ? `Сертификат сервера ${untrusted.host} ${untrusted.reason}. Выдан «${untrusted.issuer}» для «${untrusted.subject}»`
          : 'Защищённое соединение с сервером не удалось установить';
        const e = new OwaError('certificate', text, undefined, untrusted?.fingerprint);
        e.cert = untrusted;
        fail(e);
        return;
      }
      if (/ERR_INVALID_AUTH_CREDENTIALS|ERR_UNEXPECTED_SECURITY_LIBRARY_STATUS|ERR_MISCONFIGURED_AUTH_ENVIRONMENT/i.test(msg)) {
        fail(new OwaError('auth', 'Exchange не принял учётные данные'));
        return;
      }
      if (/ERR_TOO_MANY_RETRIES|ERR_INVALID_RESPONSE/i.test(msg) && authRejected) {
        fail(new OwaError('auth', 'Exchange не принял логин или пароль'));
        return;
      }
      fail(new OwaError('network', networkMessage(msg), undefined, msg));
    });

    if (req.body !== undefined) request.write(req.body);
    request.end();
  });
}

function networkMessage(chromiumError: string): string {
  if (/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED/.test(chromiumError)) return 'Сервер не найден — проверьте адрес или VPN';
  if (/ERR_INTERNET_DISCONNECTED/.test(chromiumError)) return 'Нет подключения к интернету';
  if (/ERR_CONNECTION_(REFUSED|TIMED_OUT|RESET|CLOSED|ABORTED)|ERR_ADDRESS_UNREACHABLE|ERR_TIMED_OUT|ERR_SOCKET_NOT_CONNECTED/.test(chromiumError))
    return 'Сервер недоступен — возможно, выключен VPN';
  if (/ERR_PROXY|ERR_TUNNEL_CONNECTION_FAILED|ERR_UNEXPECTED_PROXY_AUTH/.test(chromiumError)) return 'Ошибка прокси-сервера';
  if (/ERR_(HTTP2|SPDY|QUIC)_/.test(chromiumError)) return 'Сервер оборвал соединение (ошибка протокола) — возможно, запрос не пропускает шлюз или прокси';
  if (/ERR_EMPTY_RESPONSE|ERR_RESPONSE_HEADERS_TRUNCATED|ERR_INCOMPLETE_CHUNKED_ENCODING|ERR_CONTENT_LENGTH_MISMATCH/.test(chromiumError))
    return 'Сервер закрыл соединение, не ответив — возможно, запрос заблокирован';
  if (/ERR_BLOCKED_BY_(CLIENT|ADMINISTRATOR|RESPONSE)|ERR_ACCESS_DENIED/.test(chromiumError)) return 'Запрос заблокирован на этом компьютере или в сети';
  // An unknown reason: the Chromium code itself is the only useful thing to show, and it is not
  // text from the server — it is a fixed identifier, so it can be put in front of the person.
  const code = /\bERR_[A-Z0-9_]{3,60}\b/.exec(chromiumError)?.[0];
  return code ? `Нет связи с сервером Exchange (${code})` : 'Нет связи с сервером Exchange';
}

/** Configures a session for one Exchange host: SSO allow-list and certificate pinning. */
export function configureSession(ses: Session, host: string, opts: { useWindowsAuth: boolean; trustedFingerprint?: string }, cert: CertState) {
  // Ambient Windows credentials (Kerberos / NTLM) only for the configured server.
  ses.allowNTLMCredentialsForDomains(opts.useWindowsAuth ? host : '');
  ses.setCertificateVerifyProc((request, callback) => {
    if (request.errorCode === 0) {
      callback(-3); // Chromium's own (Windows store) verdict: OK
      return;
    }
    const fp = request.certificate.fingerprint;
    if (opts.trustedFingerprint && request.hostname.toLowerCase() === host.toLowerCase() && fp === opts.trustedFingerprint) {
      callback(0);
      return;
    }
    if (request.hostname.toLowerCase() === host.toLowerCase()) {
      const c = request.certificate;
      // The names inside a certificate are written by whoever made it: shown and logged as one clean line.
      cert.lastUntrusted = {
        host: oneLine(request.hostname, 255),
        fingerprint: fp,
        issuer: oneLine(c.issuerName || c.issuer?.commonName || '?', 200),
        subject: oneLine(c.subjectName || c.subject?.commonName || '?', 200),
        validTo: new Date(c.validExpiry * 1000).toISOString(),
        reason: certReason(request.verificationResult, request.errorCode),
      };
      log.warn(`certificate for ${request.hostname} rejected: ${request.verificationResult} (${request.errorCode}); issuer "${cert.lastUntrusted.issuer}", fingerprint ${fp}`);
    }
    callback(-3);
  });
}
