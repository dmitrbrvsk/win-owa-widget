// What the person typed as the server address → https://host. Free of Electron imports (unit-tested).
import { OwaError } from './errors';

export function parseBaseUrl(input: string): string {
  let cleaned = input.trim();
  if (!cleaned) throw new OwaError('other', 'Укажите адрес сервера OWA');
  // "name@company.ru" is a mailbox, not a server: the host after "@" is usually the public web site.
  if (cleaned.includes('@')) {
    throw new OwaError('other', 'Это адрес почты, а не сервера. Нужен адрес Outlook Web App из адресной строки браузера, например mail.company.ru');
  }
  if (!/^https?:\/\//i.test(cleaned)) cleaned = `https://${cleaned}`;
  let u: URL;
  try {
    u = new URL(cleaned);
  } catch {
    throw new OwaError('other', 'Некорректный адрес сервера');
  }
  // Credentials never travel over cleartext HTTP.
  if (u.protocol !== 'https:') throw new OwaError('other', 'Нужен адрес с https://');
  if (!u.hostname.includes('.') && u.hostname !== 'localhost') {
    throw new OwaError('other', `Адрес «${u.hostname}» не похож на имя сервера — укажите полное имя, например mail.company.ru`);
  }
  return `https://${u.host}`;
}
