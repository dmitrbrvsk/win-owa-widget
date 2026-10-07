// HTTP on Chromium's network stack (Electron `net`): cookies, proxy settings, the Windows
// certificate store and Integrated Windows Authentication (Kerberos / NTLM) come for free.
import { net, type Session } from 'electron';

export type OwaErrorKind = 'auth' | 'network' | 'certificate' | 'server' | 'loginHost' | 'other';

export class OwaError extends Error {
  constructor(
    public kind: OwaErrorKind,
    message: string,
    public status?: number,
    public detail?: string,
  ) {
    super(message);
    this.name = 'OwaError';
  }
}

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
  lastUntrusted?: { host: string; fingerprint: string };
}

export function sendRequest(ses: Session, req: HttpRequest, creds: CredentialPolicy, cert: CertState): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const redirects: string[] = [];
    let currentUrl = req.url;
    let loginAttempts = 0;
    let authRejected = false;
    let foreignAuthHost: string | undefined;
    let settled = false;

    const request = net.request({
      method: req.method ?? 'GET',
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

    request.on('redirect', (_status, _method, redirectUrl) => {
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
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
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
      if (/ERR_CERT_|ERR_SSL_|ERR_BAD_SSL/i.test(msg)) {
        const untrusted = cert.lastUntrusted;
        const e = new OwaError('certificate', 'Сертификат сервера не прошёл проверку', undefined, untrusted?.fingerprint);
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
    if (request.hostname.toLowerCase() === host.toLowerCase()) cert.lastUntrusted = { host: request.hostname, fingerprint: fp };
    callback(-3);
  });
}
