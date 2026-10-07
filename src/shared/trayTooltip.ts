// What the tray tooltip says. The icon is drawn in the main process (src/main/trayRaster.ts); the words
// come from here, in the language the widget is shown in.
import { composeTooltip, type TrayPresentation } from './status';
import { displayTitle } from './events';
import { oneLine } from './text';
import { duration, hm } from './format';
import type { Dict, Lang } from './i18n';

export function tooltipFor(p: TrayPresentation, t: Dict, lang: Lang): string {
  // The title comes from an invitation: one line, no control characters, shortened to leave room for the lines after it.
  const title = p.event ? oneLine(displayTitle(p.event), 100) : '';
  const build = (title: string): string => {
    switch (p.kind) {
      case 'nothing':
        return t.trayNothing;
      case 'overlap':
        return t.trayOverlap(p.count ?? 2, duration(p.minutes ?? 0, t));
      case 'inMeeting':
        return t.trayDuring(title, duration(p.minutes ?? 0, t));
      case 'imminent':
        return (p.minutes ? t.trayIn(title, duration(p.minutes, t)) : t.trayNow(title));
      case 'soon':
        return t.trayIn(title, duration(p.minutes ?? 0, t));
      case 'idle':
        return `${t.trayFreeUntil(hm(p.event!.start, lang))}\n${title}`;
      case 'tomorrow':
        return t.trayTomorrow(hm(p.event!.start, lang));
      case 'later':
        return t.trayLater(p.days ?? 2);
    }
  };
  return composeTooltip(build, title, [p.invites > 0 ? t.trayInvites(p.invites) : undefined]);
}
