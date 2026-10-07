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
  /** The organizer's SMTP address when the server gave one: it feeds the suggestions of the "Create meeting" form. */
  organizerEmail?: string;
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
  /** Plain text only: markup from an invitation never reaches the window. */
  bodyText?: string;
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

export type ReminderStyle = 'auto' | 'system' | 'window';

export interface AppSettings {
  account: AccountSettings;
  syncIntervalMinutes: number;
  /** Minutes before start to show the reminder; -1 disables reminders. */
  reminderMinutes: number;
  /** Hours the day timeline shows by default (meetings outside them widen the view). 0–23 and 1–24. */
  workdayStartHour: number;
  workdayEndHour: number;
  /** A Windows notification when a meeting is moved or cancelled, or a new invitation arrives. */
  notifyChanges: boolean;
  /** Where the "meeting starts soon" reminder appears: a Windows notification with buttons, or the widget's own window. */
  reminderStyle: ReminderStyle;
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
  /**
   * Second frame of the "meeting starts any moment" pulse, drawn once by the renderer. The main
   * process alternates the two while `pulseUntil` is in the future; a tray icon cannot animate itself.
   * Both fields come together or not at all.
   */
  pulseIconDataUrl?: string;
  /** Epoch ms when the pulse stops at the latest: the start of the meeting. */
  pulseUntil?: number;
}

export interface SaveResult {
  /** The stored password belonged to the previous server and was removed: the person has to enter it again. */
  passwordRemoved: boolean;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  eventCount?: number;
  /** Set when the test failed on the certificate, so the page can offer to trust it. */
  untrustedCert?: CertInfo;
}

/** A person from the server directory or from the meetings already loaded, offered while typing recipients. */
export interface PersonSuggestion {
  name: string;
  email: string;
}

/** What the "Create meeting" window sends. The main process validates it again and asks the person before anything leaves the machine. */
export interface CreateMeetingInput {
  title: string;
  /** ISO 8601 instants (UTC). */
  start: string;
  end: string;
  requiredAttendees: string[];
  optionalAttendees: string[];
  location: string;
  /** Plain text. */
  body: string;
}

export type CreateMeetingResult =
  /** `invited` is how many people got an invitation (0: the meeting was only saved to the calendar). */
  | { status: 'created'; invited: number }
  /** The person pressed "Cancel" in the native confirmation: nothing was sent. */
  | { status: 'cancelled' };

/** What another window may ask the "Create meeting" form to start with. Everything is optional. */
export interface CreateMeetingPrefill {
  /** ISO 8601 instants. */
  start?: string;
  end?: string;
  /** E-mail addresses (required attendees). */
  attendees?: string[];
  title?: string;
}

// ---------- Free time search ----------

/** What a free/busy answer says about a person during one slot. */
export type AvailabilityStatus = 'free' | 'tentative' | 'busy' | 'oof' | 'nodata';

/** A meeting in somebody's calendar, as far as the server told (the subject only when the viewer may see it). */
export interface AvailabilityEvent {
  /** ISO 8601 instants. */
  start: string;
  end: string;
  status: AvailabilityStatus;
  /** Cleaned and clipped; absent when the server sent no details (or the meeting is private). */
  subject?: string;
}

export interface PersonAvailability {
  /** Lower-case SMTP address the answer is for. */
  email: string;
  /**
   * One character per slot from the start of the window: 0 free, 1 tentative, 2 busy, 3 out of
   * office, 4 no data (any other character is read as no data).
   */
  digits: string;
  /** The server could not answer for this mailbox (no permission, not found, …): `digits` is then all "no data". */
  failed?: boolean;
  /** The server's error code for a failed mailbox, reduced to plain characters. */
  error?: string;
  events?: AvailabilityEvent[];
}

export interface AvailabilityRequest {
  /** SMTP addresses of the other people (at most 20); the signed-in user's own mailbox is added by the main process. */
  emails: string[];
  /** ISO 8601 instants; the window is at most 14 days. */
  start: string;
  end: string;
}

export interface AvailabilityResult {
  start: string;
  end: string;
  /** Minutes per character of `digits`. */
  slotMinutes: number;
  /** The signed-in user's own mailbox, when its address could be determined and the server answered for it. */
  self?: PersonAvailability;
  /** One entry per requested address, in the same order. */
  people: PersonAvailability[];
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
  /**
   * Right-click on a meeting: the main process pops up a native "Copy…" menu for it. Only the id
   * travels; the main process finds the meeting itself and writes the clipboard itself.
   */
  meetingMenu(eventId: string): Promise<void>;
  saveSettings(update: SettingsUpdate): Promise<SaveResult>;
  testConnection(update: SettingsUpdate): Promise<ConnectionTestResult>;
  trustCertificate(fingerprint: string): Promise<void>;
  forgetCertificate(): Promise<void>;
  /** Forgets the cached meetings and the server session, then loads everything again. Password and settings stay. */
  clearCache(): Promise<void>;
  openLog(): Promise<void>;
  openSettings(): Promise<void>;
  /** Opens the free time search window. */
  openAvailability(): Promise<void>;
  /** Free/busy of the given people for one window (at most 14 days), plus the user's own mailbox when the server tells. */
  getAvailability(request: AvailabilityRequest): Promise<AvailabilityResult>;
  closeWindow(): Promise<void>;
  quit(): Promise<void>;
  setTrayStatus(status: TrayStatus): void;
  onReminder(cb: (p: ReminderPayload) => void): () => void;
  getReminder(): Promise<ReminderPayload | null>;
  snoozeReminder(minutes: number): Promise<void>;
  onPopupShown(cb: () => void): () => void;
  /** The main process asks the popup to show a meeting (a notification was clicked). */
  onOpenEvent(cb: (eventId: string) => void): () => void;
  resizePopup(height: number): void;
  /** Directory lookup for the recipients field (at least 2 characters; at most 8 results). Goes only to the configured server. */
  resolvePeople(query: string): Promise<PersonSuggestion[]>;
  /** Creates the meeting and sends invitations, after the person confirms in a native dialog the page cannot click. */
  createMeeting(input: CreateMeetingInput): Promise<CreateMeetingResult>;
  /** Opens (or focuses) the "Create meeting" window. With a prefill, an already open form is refilled. */
  openCreateMeeting(prefill?: CreateMeetingPrefill): Promise<void>;
  /** The prefill the "Create meeting" window was opened with. */
  getCreatePrefill(): Promise<CreateMeetingPrefill | null>;
  /** The window is already open and is asked to start over with a new prefill. */
  onCreatePrefill(cb: (p: CreateMeetingPrefill) => void): () => void;
}

export const IPC = {
  getSnapshot: 'owa:getSnapshot',
  snapshot: 'owa:snapshot',
  syncNow: 'owa:syncNow',
  getDetails: 'owa:getDetails',
  respond: 'owa:respond',
  openUrl: 'owa:openUrl',
  copyText: 'owa:copyText',
  meetingMenu: 'owa:meetingMenu',
  saveSettings: 'owa:saveSettings',
  testConnection: 'owa:testConnection',
  trustCertificate: 'owa:trustCertificate',
  forgetCertificate: 'owa:forgetCertificate',
  clearCache: 'owa:clearCache',
  openLog: 'owa:openLog',
  openSettings: 'owa:openSettings',
  openAvailability: 'owa:openAvailability',
  getAvailability: 'owa:getAvailability',
  closeWindow: 'owa:closeWindow',
  quit: 'owa:quit',
  setTrayStatus: 'owa:setTrayStatus',
  reminder: 'owa:reminder',
  getReminder: 'owa:getReminder',
  snoozeReminder: 'owa:snoozeReminder',
  popupShown: 'owa:popupShown',
  openEvent: 'owa:openEvent',
  resizePopup: 'owa:resizePopup',
  openCreateMeeting: 'owa:openCreateMeeting',
  createMeeting: 'owa:createMeeting',
  resolvePeople: 'owa:resolvePeople',
  getCreatePrefill: 'owa:getCreatePrefill',
  createPrefill: 'owa:createPrefill',
} as const;
