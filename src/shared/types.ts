// Types shared by the main process, the preload bridge and the renderer.

export type MeetingPlatform = 'teams' | 'zoom' | 'webex' | 'googleMeet' | 'ktalk' | 'generic';

export type ResponseType = 'accepted' | 'tentative' | 'declined' | 'organizer' | 'notResponded';

export type RsvpAction = 'accept' | 'tentative' | 'decline';

export interface CalendarEvent {
  /** Exchange ItemId (stable per occurrence). */
  id: string;
  changeKey?: string;
  title: string;
  /** ISO 8601 instants. Dates travel as strings across IPC. */
  start: string;
  end: string;
  isAllDay: boolean;
  location?: string;
  organizer?: string;
  bodyPreview?: string;
  joinUrl?: string;
  platform: MeetingPlatform;
  isCancelled: boolean;
  isOrganizer: boolean;
  responseType: ResponseType;
  categories: string[];
  isRecurring: boolean;
}

export type AttendeeKind = 'required' | 'optional';

export interface EventAttendee {
  name: string;
  email?: string;
  kind: AttendeeKind;
  response: ResponseType;
}

export interface EventDetails {
  attendees: EventAttendee[];
  bodyText?: string;
  bodyHtml?: string;
}

export type SyncPhase = 'idle' | 'syncing' | 'ok' | 'error' | 'notConfigured';

/** A server certificate Windows rejected: what the person needs to decide whether to trust it. */
export interface CertInfo {
  host: string;
  /** "sha256/…" as Chromium reports it. */
  fingerprint: string;
  issuer: string;
  subject: string;
  /** ISO date the certificate expires. */
  validTo: string;
  /** Why Windows rejected it, in words. */
  reason: string;
}

export interface SyncState {
  phase: SyncPhase;
  /** ISO time of the last successful sync. */
  lastSuccess?: string;
  /** Human-readable error for the footer. */
  error?: string;
  /** Error category so the UI can offer the right fix. */
  errorKind?: 'auth' | 'network' | 'certificate' | 'server' | 'other';
  /** The rejected certificate, for "trust this server". */
  untrustedCert?: CertInfo;
}

export type ThemePref = 'system' | 'light' | 'dark';
export type LanguagePref = 'system' | 'ru' | 'en';
export type PopupSize = 'compact' | 'regular' | 'large';

export interface AccountSettings {
  serverUrl: string;
  /** Derived, never chosen: the signed-in Windows account (Kerberos/NTLM SSO) is used when no login and password are stored. */
  useWindowsAuth: boolean;
  /** DOMAIN\login or login@domain; used for forms login and explicit NTLM. */
  username: string;
  /** Only whether a password is stored; the password itself never reaches the renderer. */
  hasPassword: boolean;
  /**
   * A certificate the person chose to trust in the native dialog, bound to one host. Owned by the
   * main process: the settings page can only ask to forget it.
   */
  trustedCertFingerprint?: string;
  trustedCertHost?: string;
}

export interface AppSettings {
  account: AccountSettings;
  syncIntervalMinutes: number;
  /** Minutes before start to show the reminder; -1 disables reminders. */
  reminderMinutes: number;
  /** Hours the day timeline shows by default (meetings outside them widen the view). 0–23 and 1–24. */
  workdayStartHour: number;
  workdayEndHour: number;
  launchAtLogin: boolean;
  theme: ThemePref;
  language: LanguagePref;
  popupSize: PopupSize;
  joinHotkeyEnabled: boolean;
}

export interface SettingsUpdate {
  settings: AppSettings;
  /** New password; undefined keeps the stored one, '' clears it. */
  password?: string;
}

export interface Snapshot {
  events: CalendarEvent[];
  sync: SyncState;
  settings: AppSettings;
  demo: boolean;
  version: string;
  /** Where the diagnostic log lives, for the settings page. */
  logPath: string;
  /** Windows taskbar uses the light theme (dark tray glyph needed). */
  taskbarLight: boolean;
}

export interface ReminderPayload {
  events: CalendarEvent[];
}

export interface TrayStatus {
  /** PNG data URL, 32×32, drawn by the renderer. */
  iconDataUrl: string;
  tooltip: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  eventCount?: number;
  /** Set when the test failed on the certificate, so the page can offer to trust it. */
  untrustedCert?: CertInfo;
}

/** API exposed by the preload script as `window.owa`. */
export interface OwaApi {
  getSnapshot(): Promise<Snapshot>;
  onSnapshot(cb: (s: Snapshot) => void): () => void;
  syncNow(): Promise<void>;
  getDetails(eventId: string): Promise<EventDetails>;
  respond(eventId: string, action: RsvpAction): Promise<void>;
  openUrl(url: string): Promise<void>;
  copyText(text: string): Promise<void>;
  saveSettings(update: SettingsUpdate): Promise<void>;
  testConnection(update: SettingsUpdate): Promise<ConnectionTestResult>;
  trustCertificate(fingerprint: string): Promise<void>;
  forgetCertificate(): Promise<void>;
  openLog(): Promise<void>;
  openSettings(): Promise<void>;
  closeWindow(): Promise<void>;
  quit(): Promise<void>;
  setTrayStatus(status: TrayStatus): void;
  onReminder(cb: (p: ReminderPayload) => void): () => void;
  getReminder(): Promise<ReminderPayload | null>;
  snoozeReminder(minutes: number): Promise<void>;
  onPopupShown(cb: () => void): () => void;
  resizePopup(height: number): void;
}

export const IPC = {
  getSnapshot: 'owa:getSnapshot',
  snapshot: 'owa:snapshot',
  syncNow: 'owa:syncNow',
  getDetails: 'owa:getDetails',
  respond: 'owa:respond',
  openUrl: 'owa:openUrl',
  copyText: 'owa:copyText',
  saveSettings: 'owa:saveSettings',
  testConnection: 'owa:testConnection',
  trustCertificate: 'owa:trustCertificate',
  forgetCertificate: 'owa:forgetCertificate',
  openLog: 'owa:openLog',
  openSettings: 'owa:openSettings',
  closeWindow: 'owa:closeWindow',
  quit: 'owa:quit',
  setTrayStatus: 'owa:setTrayStatus',
  reminder: 'owa:reminder',
  getReminder: 'owa:getReminder',
  snoozeReminder: 'owa:snoozeReminder',
  popupShown: 'owa:popupShown',
  resizePopup: 'owa:resizePopup',
} as const;
