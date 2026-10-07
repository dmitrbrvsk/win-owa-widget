// Redirect policy, kept free of Electron imports so it can be unit-tested.

/** Why a redirect must not be followed (null = fine): other host, or a downgrade to cleartext. */
export function redirectRefusal(target: string, host: string): string | null {
  let u: URL;
  try {
    u = new URL(target);
  } catch {
    return 'Сервер прислал некорректный адрес перенаправления';
  }
  if (u.protocol !== 'https:') return 'Сервер перенаправляет на незащищённое соединение (http)';
  if (u.hostname.toLowerCase() !== host.toLowerCase()) {
    return `Сервер перенаправляет вход на ${u.hostname}. Вход через другой портал (единый вход, SSO) пока не поддерживается — попробуйте оставить логин и пароль пустыми (вход под учётной записью Windows)`;
  }
  return null;
}
