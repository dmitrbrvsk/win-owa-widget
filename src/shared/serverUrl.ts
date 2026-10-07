// What the person typed as the server address → https://host. Shared by the settings page (live
// hint under the field) and the main process (the only place that decides what is connected to).

export type ServerUrlProblem = 'empty' | 'email' | 'invalid' | 'http' | 'bare';

export type ServerUrlCheck = { ok: true; url: string; host: string } | { ok: false; problem: ServerUrlProblem; detail?: string };

export function checkServerUrl(input: string): ServerUrlCheck {
  let cleaned = input.trim();
  if (!cleaned) return { ok: false, problem: 'empty' };
  // "name@company.ru" is a mailbox, not a server: the host after "@" is usually the public web site.
  if (cleaned.includes('@')) return { ok: false, problem: 'email' };
  if (!/^https?:\/\//i.test(cleaned)) cleaned = `https://${cleaned}`;
  let u: URL;
  try {
    u = new URL(cleaned);
  } catch {
    return { ok: false, problem: 'invalid' };
  }
  // Credentials never travel over cleartext HTTP.
  if (u.protocol !== 'https:') return { ok: false, problem: 'http' };
  if (!u.hostname.includes('.') && u.hostname !== 'localhost') return { ok: false, problem: 'bare', detail: u.hostname };
  return { ok: true, url: `https://${u.host}`, host: u.hostname };
}

/** Wording for the main process, which speaks Russian in its errors. */
export const SERVER_URL_MESSAGES_RU: Record<ServerUrlProblem, (detail?: string) => string> = {
  empty: () => 'Укажите адрес сервера OWA',
  email: () => 'Это адрес почты, а не сервера. Нужен адрес Outlook Web App из адресной строки браузера, например mail.company.ru',
  invalid: () => 'Некорректный адрес сервера',
  http: () => 'Нужен адрес с https://',
  bare: (d) => `Адрес «${d}» не похож на имя сервера — укажите полное имя, например mail.company.ru`,
};

export function serverUrlError(check: ServerUrlCheck): string | undefined {
  return check.ok ? undefined : SERVER_URL_MESSAGES_RU[check.problem](check.detail);
}
