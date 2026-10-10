import type { MouseEvent } from 'react';
import { api } from './api';

/**
 * Spread on anything that shows a meeting: a right-click asks the main process for its native
 * "Copy…" menu. Only the id is sent; what gets copied is decided there.
 */
export function meetingMenuProps(eventId: string) {
  return {
    onContextMenu: (ev: MouseEvent) => {
      ev.preventDefault();
      void api.meetingMenu(eventId).catch(() => undefined);
    },
  };
}
