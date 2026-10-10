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

/** Another time for a meeting, as the person would like it: two instants with a zone. */
export interface ReplyProposal {
  start: string;
  end: string;
}

/** An answer to an invitation that carries words: a comment, another time, or both. */
export interface MeetingReplyInput {
  eventId: string;
  action: RsvpAction;
  /** Plain text, at most `MAX_REPLY_COMMENT` characters; may be empty when a time is proposed. */
  comment: string;
  proposal?: ReplyProposal;
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
  /** The short tour has been seen (or skipped): it opens by itself only once. */
  welcomeDone: boolean;
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
  /** The meetings the person has written a note on (the notes themselves are asked for one at a time). */
  noteIds: string[];
}

export interface ReminderPayload {
  events: CalendarEvent[];
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
/** How a meeting repeats. "weekdays" is Monday to Friday; "biweekly" is every second week. */
export type RecurrenceKind = 'none' | 'daily' | 'weekdays' | 'weekly' | 'biweekly';

/** When a repeating meeting stops. There is no "never": a series without an end is a series nobody counted. */
export type RecurrenceEnd = { kind: 'count'; count: number } | { kind: 'until'; date: string };

export interface Recurrence {
  kind: RecurrenceKind;
  /** Absent only for `kind: 'none'`. */
  end?: RecurrenceEnd;
}

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
  recurrence: Recurrence;
}

/** A change to a meeting the person organizes. The id is the meeting's; everything else is the new state. */
export interface EditMeetingInput extends CreateMeetingInput {
  id: string;
}

/** What the main process found the meeting to be before the change: the diff is computed there, not in the window. */
export interface MeetingBefore {
  id: string;
  changeKey?: string;
  title: string;
  start: string;
  end: string;
  location: string;
  body: string;
  requiredAttendees: string[];
  optionalAttendees: string[];
}

export type CreateMeetingResult =
  /** `invited` is how many people got an invitation (0: the meeting was only saved to the calendar). */
  | { status: 'created'; invited: number }
  /** The meeting was changed; `invited` is how many people were told. */
  | { status: 'updated'; invited: number }
  /** The meeting was called off; `invited` is how many people were told. */
  | { status: 'cancelledMeeting'; invited: number }
  /** The organizer was sent the person's answer with a comment (and, maybe, another time). */
  | { status: 'replied'; invited: number }
  /** The person pressed "Cancel" in the native confirmation: nothing was sent. */
  | { status: 'cancelled' };

/** What another window may ask the "Create meeting" form to start with. Everything is optional. */
export interface CreateMeetingPrefill {
  /** ISO 8601 instants. */
  start?: string;
  end?: string;
  /** E-mail addresses (required attendees). */
  attendees?: string[];
  optional?: string[];
  title?: string;
  location?: string;
  body?: string;
  /** Set when the form is editing a meeting that already exists; the window then saves instead of creating. */
  editId?: string;
  /** Whether that meeting is part of a series, so the form can say the whole series is changed. */
  editRecurring?: boolean;
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

// ---------- Meeting statistics ----------

/**
 * The period the statistics window asks the server for. The widget keeps only a short range in
 * memory, so the window asks for the whole period at once; the main process validates it (at most
 * 60 days, near today) and answers with the same `CalendarEvent[]` the rest of the app uses.
 */
export interface StatsRequest {
  /** ISO 8601 instants; the period is at most 60 days. */
  start: string;
  end: string;
}

/** API exposed by the preload script as `window.owa`. */
export interface OwaApi {
  getSnapshot(): Promise<Snapshot>;
  onSnapshot(cb: (s: Snapshot) => void): () => void;
  syncNow(): Promise<void>;
  getDetails(eventId: string): Promise<EventDetails>;
  respond(eventId: string, action: RsvpAction): Promise<void>;
  /**
   * Answers an invitation with a comment and/or another time. The organizer is mailed, so the main
   * process asks the person in a native dialog first, from the validated text.
   */
  replyToMeeting(input: MeetingReplyInput): Promise<CreateMeetingResult>;
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
  /** The person's own note on a meeting ('' when there is none). It never leaves this computer. */
  getNote(eventId: string): Promise<string>;
  /** Saves the note (an empty text removes it). */
  setNote(eventId: string, text: string): Promise<void>;
  /** Deletes every note after a native confirmation; resolves to how many were deleted. */
  clearNotes(): Promise<number>;
  openLog(): Promise<void>;
  openSettings(): Promise<void>;
  /** Opens the free time search window. */
  openAvailability(): Promise<void>;
  /** Free/busy of the given people for one window (at most 14 days), plus the user's own mailbox when the server tells. */
  getAvailability(request: AvailabilityRequest): Promise<AvailabilityResult>;
  /** Opens the meeting statistics window. */
  openStats(): Promise<void>;
  /** The person's own meetings for one period (at most 60 days), in one calendar view request. */
  getStatsEvents(request: StatsRequest): Promise<CalendarEvent[]>;
  closeWindow(): Promise<void>;
  quit(): Promise<void>;
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
  /** Opens the "Create meeting" window filled with an existing meeting, to change it. */
  openEditMeeting(eventId: string): Promise<void>;
  /** Saves a change to a meeting that exists; the main process asks the person first. */
  editMeeting(input: EditMeetingInput): Promise<CreateMeetingResult>;
  /** Calls a meeting off and tells everyone invited; the main process asks the person first. */
  cancelMeeting(eventId: string): Promise<CreateMeetingResult>;
  /** Opens the short tour (from the settings; it opens by itself only on the first run). */
  openWelcome(): Promise<void>;
  /** Closes the tour and remembers that it has been seen; `openSettings` opens the settings afterwards. */
  finishWelcome(openSettings: boolean): Promise<void>;
}

export const IPC = {
  getSnapshot: 'owa:getSnapshot',
  snapshot: 'owa:snapshot',
  syncNow: 'owa:syncNow',
  getDetails: 'owa:getDetails',
  respond: 'owa:respond',
  replyToMeeting: 'owa:replyToMeeting',
  openUrl: 'owa:openUrl',
  copyText: 'owa:copyText',
  meetingMenu: 'owa:meetingMenu',
  saveSettings: 'owa:saveSettings',
  testConnection: 'owa:testConnection',
  trustCertificate: 'owa:trustCertificate',
  forgetCertificate: 'owa:forgetCertificate',
  clearCache: 'owa:clearCache',
  getNote: 'owa:getNote',
  setNote: 'owa:setNote',
  clearNotes: 'owa:clearNotes',
  openLog: 'owa:openLog',
  openSettings: 'owa:openSettings',
  openAvailability: 'owa:openAvailability',
  getAvailability: 'owa:getAvailability',
  openStats: 'owa:openStats',
  getStatsEvents: 'owa:getStatsEvents',
  closeWindow: 'owa:closeWindow',
  quit: 'owa:quit',
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
  openWelcome: 'owa:openWelcome',
  openEditMeeting: 'owa:openEditMeeting',
  editMeeting: 'owa:editMeeting',
  cancelMeeting: 'owa:cancelMeeting',
  finishWelcome: 'owa:finishWelcome',
} as const;
