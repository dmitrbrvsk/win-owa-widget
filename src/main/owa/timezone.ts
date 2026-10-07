// Exchange wants a Windows time zone id ("Russian Standard Time") in TimeZoneContext.
// On Windows we ask the OS directly (`tzutil /g`); elsewhere (dev on macOS/Linux) we map IANA.
import { execFile } from 'node:child_process';
import { join } from 'node:path';

const IANA_TO_WINDOWS: Record<string, string> = {
  'Europe/Moscow': 'Russian Standard Time',
  'Europe/Simferopol': 'Russian Standard Time',
  'Europe/Kirov': 'Russian Standard Time',
  'Europe/Volgograd': 'Volgograd Standard Time',
  'Europe/Kaliningrad': 'Kaliningrad Standard Time',
  'Europe/Samara': 'Russia Time Zone 3',
  'Europe/Ulyanovsk': 'Astrakhan Standard Time',
  'Europe/Astrakhan': 'Astrakhan Standard Time',
  'Europe/Saratov': 'Saratov Standard Time',
  'Asia/Yekaterinburg': 'Ekaterinburg Standard Time',
  'Asia/Omsk': 'Omsk Standard Time',
  'Asia/Novosibirsk': 'N. Central Asia Standard Time',
  'Asia/Barnaul': 'Altai Standard Time',
  'Asia/Tomsk': 'Tomsk Standard Time',
  'Asia/Novokuznetsk': 'North Asia Standard Time',
  'Asia/Krasnoyarsk': 'North Asia Standard Time',
  'Asia/Irkutsk': 'North Asia East Standard Time',
  'Asia/Chita': 'Transbaikal Standard Time',
  'Asia/Yakutsk': 'Yakutsk Standard Time',
  'Asia/Vladivostok': 'Vladivostok Standard Time',
  'Asia/Sakhalin': 'Sakhalin Standard Time',
  'Asia/Magadan': 'Magadan Standard Time',
  'Asia/Srednekolymsk': 'Russia Time Zone 10',
  'Asia/Kamchatka': 'Russia Time Zone 11',
  'Europe/Minsk': 'Belarus Standard Time',
  'Europe/Kiev': 'FLE Standard Time',
  'Europe/Kyiv': 'FLE Standard Time',
  'Europe/Riga': 'FLE Standard Time',
  'Europe/Vilnius': 'FLE Standard Time',
  'Europe/Tallinn': 'FLE Standard Time',
  'Europe/Helsinki': 'FLE Standard Time',
  'Europe/Istanbul': 'Turkey Standard Time',
  'Europe/London': 'GMT Standard Time',
  'Europe/Dublin': 'GMT Standard Time',
  'Europe/Lisbon': 'GMT Standard Time',
  'Europe/Berlin': 'W. Europe Standard Time',
  'Europe/Amsterdam': 'W. Europe Standard Time',
  'Europe/Rome': 'W. Europe Standard Time',
  'Europe/Vienna': 'W. Europe Standard Time',
  'Europe/Zurich': 'W. Europe Standard Time',
  'Europe/Stockholm': 'W. Europe Standard Time',
  'Europe/Oslo': 'W. Europe Standard Time',
  'Europe/Paris': 'Romance Standard Time',
  'Europe/Madrid': 'Romance Standard Time',
  'Europe/Brussels': 'Romance Standard Time',
  'Europe/Copenhagen': 'Romance Standard Time',
  'Europe/Prague': 'Central Europe Standard Time',
  'Europe/Budapest': 'Central Europe Standard Time',
  'Europe/Belgrade': 'Central Europe Standard Time',
  'Europe/Warsaw': 'Central European Standard Time',
  'Europe/Athens': 'GTB Standard Time',
  'Europe/Bucharest': 'GTB Standard Time',
  'Europe/Chisinau': 'E. Europe Standard Time',
  'Asia/Tbilisi': 'Georgian Standard Time',
  'Asia/Yerevan': 'Caucasus Standard Time',
  'Asia/Baku': 'Azerbaijan Standard Time',
  'Asia/Almaty': 'Central Asia Standard Time',
  'Asia/Astana': 'Central Asia Standard Time',
  'Asia/Bishkek': 'Central Asia Standard Time',
  'Asia/Tashkent': 'West Asia Standard Time',
  'Asia/Dushanbe': 'West Asia Standard Time',
  'Asia/Ashgabat': 'West Asia Standard Time',
  'Asia/Dubai': 'Arabian Standard Time',
  'Asia/Tehran': 'Iran Standard Time',
  'Asia/Jerusalem': 'Israel Standard Time',
  'Asia/Kolkata': 'India Standard Time',
  'Asia/Shanghai': 'China Standard Time',
  'Asia/Hong_Kong': 'China Standard Time',
  'Asia/Singapore': 'Singapore Standard Time',
  'Asia/Tokyo': 'Tokyo Standard Time',
  'Asia/Seoul': 'Korea Standard Time',
  'Asia/Bangkok': 'SE Asia Standard Time',
  'Australia/Sydney': 'AUS Eastern Standard Time',
  'America/New_York': 'Eastern Standard Time',
  'America/Toronto': 'Eastern Standard Time',
  'America/Chicago': 'Central Standard Time',
  'America/Denver': 'Mountain Standard Time',
  'America/Phoenix': 'US Mountain Standard Time',
  'America/Los_Angeles': 'Pacific Standard Time',
  'America/Sao_Paulo': 'E. South America Standard Time',
  'UTC': 'UTC',
  'Etc/UTC': 'UTC',
};

let cached: string | undefined;

export function windowsTimezoneFromIana(iana: string): string {
  return IANA_TO_WINDOWS[iana] ?? 'Russian Standard Time';
}

export async function windowsTimezoneId(): Promise<string> {
  if (cached) return cached;
  if (process.platform === 'win32') {
    const fromOs = await new Promise<string | undefined>((resolve) => {
      // Full path: a program with the same name earlier in PATH must not be able to stand in.
      const tzutil = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tzutil.exe');
      execFile(tzutil, ['/g'], { windowsHide: true, timeout: 3000 }, (err, stdout) => {
        resolve(err ? undefined : stdout.trim() || undefined);
      });
    });
    // tzutil appends "_dstoff" when automatic DST is disabled; Exchange does not know that suffix.
    if (fromOs) return (cached = fromOs.replace(/_dstoff$/i, ''));
  }
  return (cached = windowsTimezoneFromIana(Intl.DateTimeFormat().resolvedOptions().timeZone));
}
