// HTTP on Chromium's network stack (Electron `net`): cookies, proxy settings, the Windows
// certificate store and Integrated Windows Authentication (Kerberos / NTLM) come for free.
import { net, type Session } from 'electron';
import type { CertInfo } from '../../shared/types';
import { log, safeUrlForLog } from '../log';
import { certReason, OwaError } from './errors';
export { OwaError, type OwaErrorKind } from './errors';
import { redirectRefusal } from './redirect';

/** A calendar answer is a few hundred KB; anything bigger is a broken or hostile server. */
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

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
  username?: string;
  password?: string;
}

/** Shared state the session's certificate hook writes and requests read. */
export interface CertState {
  lastUntrusted?: CertInfo;
}

export function sendRequest(ses: Session, req: HttpRequest, creds: CredentialPolicy, cert: CertState): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
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
      const refusal = redirectRefusal(redirectUrl, creds.host);
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
      const hostOk = authInfo.host.toLowerCase() === creds.host.toLowerCase();
      log.info(`${tag}: ${authInfo.scheme} challenge from ${authInfo.host}${hostOk ? '' : ' (foreign host, no credentials)'}${creds.username ? '' : ' (no stored login)'}`);
      if (!hostOk) {
        // Never hand the domain password to a host other than the configured server.
        foreignAuthHost = authInfo.host;
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
        resolve({
          status: res.statusCode,
          url: currentUrl,
          headers: res.headers,
          body,
          text: () => body.toString('utf8'),
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
  if (/ERR_CONNECTION_(REFUSED|TIMED_OUT|RESET|CLOSED)|ERR_ADDRESS_UNREACHABLE|ERR_TIMED_OUT/.test(chromiumError))
    return 'Сервер недоступен — возможно, выключен VPN';
  if (/ERR_PROXY/.test(chromiumError)) return 'Ошибка прокси-сервера';
  return 'Нет связи с сервером Exchange';
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
      cert.lastUntrusted = {
        host: request.hostname,
        fingerprint: fp,
        issuer: c.issuerName || c.issuer?.commonName || '?',
        subject: c.subjectName || c.subject?.commonName || '?',
        validTo: new Date(c.validExpiry * 1000).toISOString(),
        reason: certReason(request.verificationResult, request.errorCode),
      };
      log.warn(`certificate for ${request.hostname} rejected: ${request.verificationResult} (${request.errorCode}); issuer "${cert.lastUntrusted.issuer}", fingerprint ${fp}`);
    }
    callback(-3);
  });
}
