// Where requests may go, kept free of Electron imports so it can be unit-tested.
//
// The one origin the person configured (https, this host and this port) is the only place a
// request, a redirect or a login form may lead. `origin` is `URL.host` of the server address:
// the host name, plus the port when it is not 443.

function parse(target: string): URL | null {
  try {
    return new URL(target);
  } catch {
    return null;
  }
}

/** Why a redirect must not be followed (null = fine): other host or port, or a downgrade to cleartext. */
export function redirectRefusal(target: string, origin: string): string | null {
  const u = parse(target);
  if (!u) return 'Сервер прислал некорректный адрес перенаправления';
  if (u.protocol !== 'https:') return 'Сервер перенаправляет на незащищённое соединение (http)';
  if (u.host.toLowerCase() !== origin.toLowerCase()) {
    return `Сервер перенаправляет вход на ${u.host}. Вход через другой портал (единый вход, SSO) пока не поддерживается — попробуйте оставить логин и пароль пустыми (вход под учётной записью Windows)`;
  }
  return null;
}

/** Why a request may not be sent at all (null = fine): the same rule applied to the first URL, not only to redirects. */
export function requestRefusal(target: string, origin: string): string | null {
  const u = parse(target);
  if (!u || u.protocol !== 'https:' || u.host.toLowerCase() !== origin.toLowerCase()) {
    return `Приложение отправляет запросы только на https://${origin}`;
  }
  return null;
}
