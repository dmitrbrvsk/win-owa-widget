// The Electron side of Windows notifications with buttons. What a toast says and which button
// does what is decided by pure code in shared/toasts.ts; this file only shows it and reports the
// answer. A toast carries no data of its own: a pressed button comes back as an index in the list
// built here, and the caller runs the action from its own state.
import { Notification } from 'electron';
import { layoutToast, resolveAction, type ToastActionId, type ToastDef } from '../shared/toasts';
import { describeError, log } from './log';
import { oneLine } from '../shared/text';

export interface ToastHandlers {
  /** A button was pressed. `snoozeMinutes` is the drop-down choice (the first item when it was left alone). */
  onAction?: (id: ToastActionId, snoozeMinutes: number) => void;
  /** The text of the notification was clicked. */
  onClick?: () => void;
  /** Windows could not show it, so the caller can fall back to its own window. */
  onFailed?: () => void;
}

export interface ToastOptions {
  /** Stays on screen until the person deals with it (a meeting reminder). */
  sticky?: boolean;
  silent?: boolean;
  /** A new toast of the same group replaces the previous one (an old reminder is no use next to a new one). */
  group?: string;
}

/**
 * Notifications on screen. A reference has to be kept: a Notification that is collected loses its
 * click handlers, and a button press would silently do nothing.
 */
const live = new Map<Notification, string | undefined>();

export const toastsSupported = () => Notification.isSupported();

function dismiss(group: string) {
  for (const [n, g] of [...live]) {
    if (g !== group) continue;
    live.delete(n);
    try {
      n.close();
    } catch {
      /* already gone */
    }
  }
}

/** Returns false when nothing could be shown, so the caller can use something else. */
export function showToast(def: ToastDef, handlers: ToastHandlers, opts: ToastOptions = {}): boolean {
  if (!Notification.isSupported()) return false;
  if (opts.group) dismiss(opts.group);
  const layout = layoutToast(def);
  let n: Notification;
  try {
    n = new Notification({
      title: def.title,
      body: def.body,
      silent: opts.silent ?? false,
      timeoutType: opts.sticky ? 'never' : 'default',
      ...(layout.actions.length ? { actions: layout.actions } : {}),
    });
  } catch (e) {
    log.warn(`toast: not created: ${describeError(e)}`);
    return false;
  }
  live.set(n, opts.group);
  let acted = false;
  const guard = (what: string, fn: () => void) => {
    try {
      fn();
    } catch (e) {
      log.warn(`toast: ${what} failed: ${describeError(e)}`);
    }
  };

  n.on('click', () => guard('click', () => handlers.onClick?.()));
  n.on('action', (details, positional, positionalSelection) => {
    if (acted) return; // one press, one action
    // Electron 44 reports the pressed entry on the event; older builds pass it as an argument.
    const actionIndex = typeof details?.actionIndex === 'number' ? details.actionIndex : positional;
    const selectionIndex = typeof details?.selectionIndex === 'number' ? details.selectionIndex : (positionalSelection ?? -1);
    const picked = resolveAction(def, layout, actionIndex, selectionIndex);
    if (!picked) return;
    acted = true;
    guard(`action ${picked.id}`, () => handlers.onAction?.(picked.id, picked.minutes));
  });
  n.on('close', () => live.delete(n));
  n.on('failed', (_e, error) => {
    live.delete(n);
    log.warn(`toast: Windows could not show it: ${oneLine(String(error), 200)}`);
    guard('fallback', () => handlers.onFailed?.());
  });
  try {
    n.show();
  } catch (e) {
    live.delete(n);
    log.warn(`toast: not shown: ${describeError(e)}`);
    return false;
  }
  // Only counts: what a meeting is called does not belong in a log that is meant to be sent around.
  log.info(`toast: handed to Windows${opts.group ? ` (${opts.group})` : ''}, ${def.buttons.length} button(s)`);
  return true;
}
