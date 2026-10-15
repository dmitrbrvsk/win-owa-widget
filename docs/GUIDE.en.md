# OWA Widget Guide

[Русский](GUIDE.md) | English

[← Overview and download](../README.en.md)

Details about features, connection and diagnostics. New interface demos are in the [README](../README.en.md).

## Contents

- [Features](#features)
- [Frequently asked questions](#faq)
- [Troubleshooting](#troubleshooting)
- [Groups, privacy and diagnostics](#groups-privacy-and-diagnostics)
- [Security](#security)
- [Memory](#memory)
- [For developers](#for-developers)
- [Interface gallery](#interface-gallery)

## Features

### Calendar and tray icon

- **Tray icon with a countdown.** Starting 15 minutes before a meeting, the icon shows the minutes until it starts; during the meeting, it shows the time remaining. A yellow dot in the corner means there are invitations you have not answered. In the last 2 minutes, the icon turns red; if you are attending the meeting (you accepted the invitation or are its organizer), it also flashes, alternating between filled and outlined states for no more than 2.5 minutes. When Windows animations are disabled, it stays red without flashing. The tooltip shows the meeting title and invitation count.
- **Window by the tray.** Opens next to the icon at any edge of the screen. It contains the next meeting with a “Join” button (from 30 minutes before the start until the meeting ends), a strip of the day's meetings, and a timeline with a red “now” line. Overlapping meetings appear side by side.
- **Large calendar window.** “Calendar…” in the tray menu or the widget's expand button opens the schedule and the selected meeting's details side by side. It opens maximized the first time; you can resize it and move it to another monitor. Closing it leaves the app in the tray. Opening it from a meeting's details preserves the day and selected meeting. Ctrl+F opens search; date selection and search use meetings already loaded and do not request an archive from the server. Privacy mode also applies to this window.
- **Working day.** The timeline shows working hours only (08:00–20:00 by default, configurable); meetings outside those hours still appear because the range expands to include them.
- **Meeting details.** Attendees and their responses, the full description with links, copying the link or “title + time + link”. The same actions are available by right-clicking a meeting on the timeline.
- **Meeting search.** Press Ctrl+F or `/` in the window; Esc closes it. Searches the title, organizer, location, categories and the beginning of the description; every search word must match. The Russian letters U+0435 and U+0451 are treated as equivalent. Only meetings already loaded are searched; the query is neither sent to the server nor written to the log.

### Calls

- **Call links.** Teams, Zoom, Webex, Google Meet and KTalk links are detected in the online-meeting field, location and description. If a link points to an unfamiliar site, its actual address appears beside “Join” everywhere: in the window, timeline, search results, notification and tray menu.

### Invitations and meetings

- **Invitation responses.** “Accept”, “Tentative” and “Decline” without Outlook, from the window or directly from a notification. New invitations are grouped at the top.
- **Reply with a comment and “Propose another time”.** Add a comment of up to 1000 characters to your response or suggest another time: the organizer receives a message with your response and the new time. This is a normal response containing text, not an Outlook counterproposal (Exchange does not accept those through this interface): it does not move the meeting in the organizer's calendar. A native Windows dialog shows the reply text before sending.
- **Overlap warning.** If an invitation overlaps a meeting you accepted or organize, a marker appears in the list and meeting details; you can decline the extra meeting in two clicks.
- **Personal meeting notes.** The “My note” field in meeting details; notes stay on your computer in an encrypted file (DPAPI), are never sent anywhere and are not visible to attendees. They are deleted automatically three months after the meeting, or all at once in Settings.
- **Create meetings** with invitations, including **recurring meetings**, **change and cancel** your own meetings while notifying attendees, and **find free time** using availability: see [Creating a meeting](#creating-a-meeting) and [Finding free time](#finding-free-time).
- **Meeting statistics** for a week or month: how much time meetings take and whom you meet with — see [Meeting statistics](#meeting-statistics).
- **Meeting reminders:** Windows notifications with buttons or the app's own window above the taskbar (choose in Settings). Meetings starting at nearly the same time are shown together.
- **Change notifications:** “Meeting moved”, “Meeting cancelled”, “New invitation”. At most six per hour; if many meetings change at once (for example, a recurring series is edited), one summary notification is shown.

### Sign-in, security and appearance

- **Sign-in.** With no login or password supplied, the app uses your Windows account (Kerberos / NTLM, no password needed). With credentials supplied, it uses NTLM or, for older servers, the OWA login form. The address field needs your OWA server (the address in your browser, for example `mail.company.ru`), not an email address. The default is `owa.alfabank.ru`; Settings opens on first launch so you can replace it.
- **Security.** Windows encrypts the password using DPAPI; it is bound to your server and sent only there. Only HTTPS is allowed; redirects to another host or port are stopped. Changing servers requires a native confirmation dialog. Certificates are checked against the Windows certificate store; trusting an internal certificate requires a native dialog showing its fingerprint. The meeting cache is encrypted. Only `http(s)` links can be opened. See [Security](#security) and [SECURITY.en.md](../SECURITY.en.md).
- **First-run introduction:** four steps explaining where the icon lives, how to connect and what the app does. Shown once, can be skipped with one click, and can be reopened from Settings.
- Light and dark themes, Russian and English, startup when you sign in to Windows, and three window sizes.

### Language of native connection dialogs

The native dialogs for changing the server and trusting a certificate currently remain in Russian, even when English is selected. Their key buttons are **“Отмена” = Cancel**, **“Подключиться” = Connect**, and **“Довериться этому сертификату” = Trust this certificate**. Check the server address before connecting. For an internal certificate, ask your IT team for the company root certificate or a verified fingerprint, and compare that fingerprint with the one shown in the dialog. If it differs or you cannot verify it, choose **“Отмена” (Cancel)**. The English interface does not yet mean that every native dialog is localized.

More details about the main features follow.

### Creating a meeting

Open it with the “+” button in the tray window, “Create meeting…” in the tray menu, or “Create a meeting at this time” in the free-time window (the time is filled in automatically).

- **Attendees.** “Required” and “Optional”. Start typing a name or address to get suggestions from the Exchange address book. Paste a complete address or a list separated by commas, semicolons or newlines. Only ordinary addresses using Latin letters and digits are accepted: addresses with lookalike Cyrillic letters are rejected so an invitation is not sent to an impersonator.
- **Time.** Start and end dates and times, with quick duration choices of 30 / 45 minutes or 1 hour. Times are sent to the server as exact instants, so daylight-saving transitions do not shift them.
- **Confirmation.** When a meeting has attendees, Windows shows a **native dialog** before sending, containing the subject, time, location, beginning of the description and recipients (the first 15, then “and N more”). It is built from the data that will be sent to the server and defaults to “Cancel”. The meeting-creation window cannot press its buttons: even a compromised interface page cannot send invitations. A personal meeting without attendees also requires native confirmation before it is saved.
- **Limits.** At most 10 meetings and 300 invitees per hour; one send operation at a time; no more than 12 confirmation requests per 10 minutes. This guards against accidental loops and a stuck page.
- **If the server response does not arrive** because the connection drops, the app does not retry sending automatically: a retry could send a second invitation to everyone. It asks you to check your calendar first.
- **Recurring meetings.** “Every day”, “Every weekday”, “Every week” or “Every two weeks”, ending after a number of occurrences (at most 100) or on a date (no more than two years away). The confirmation dialog states the occurrence count: you cannot send fifty invitations without seeing that number.
- **Changing your meeting.** Meeting details for a meeting you organize include “Change”: it opens the same form with the current values filled in. Only changed fields are sent to the server; attendees are notified, and the confirmation dialog shows exactly what changes, including the old and new times and attendees added or removed.
- **Cancelling your meeting.** “Cancel the meeting” in meeting details sends a cancellation notice to all invitees. The confirmation states how many people will be notified and that the meeting cannot be restored. The safe response (“Do not cancel”) is selected by default.
- **Not tested against a real Exchange server.** The `CreateItem`, `UpdateItem`, `CancelCalendarItem` and `ResolveNames` requests follow the EWS documentation and have been checked against a fake server and in unit tests. Try your first meeting without attendees or with only yourself.

### Finding free time

Open it using the calendar button in the tray window or “Find free time…” in the tray menu.

- Specify up to 20 attendees (addresses or names from the address book) and a duration (30 / 45 / 60 / 90 minutes). The grid shows availability in 30-minute slots during working hours (hours and weekdays come from Settings). Use the arrows to change weeks; “Weekends” includes Saturday and Sunday.
- Colors: “Free”, “Tentative”, “Busy”, “Out of office”, “No data” (you cannot access the person's calendar or the server did not respond). Other people's meeting titles are shown only where Exchange allows you to see them.
- “Best options” lists up to five intervals of the requested duration when nobody is busy or out of office. Tentative availability does not block an interval but lowers its score and is marked; a person with no data also does not block it, but the option is marked less reliable (no options are offered when nobody has data). Earlier times and times closer to the start of an hour rank higher; lunch and weekends rank lower. Past times are not suggested, and at most two options per day are shown. The selected option is highlighted in the grid; “Create a meeting at this time” opens the meeting form with the time and attendees filled in.
- Your availability comes from the server using your mailbox address. If the server did not provide that address, the calendar already loaded by the widget is used, with a note beneath the grid.
- The request goes only to the configured Exchange server (`GetUserAvailability`); the window requests at most 20 addresses and 14 days at a time. Responses are parsed with size and time limits.
- **Not tested against a real Exchange server:** the request follows the EWS documentation and has been checked against a fake server and in unit tests.

### Meeting statistics

Open it using the chart button in the tray window or “Meeting statistics…” in the tray menu.

- **Period:** “This week”, “Last week”, “Last 4 weeks” (weeks start on Monday; the dates are shown alongside).
- **Key figures at the top:** total meeting time, share of working hours (from Settings), meeting count, average duration, busiest day, number of back-to-back meetings (starting when another ends), and working time left free. Overlapping meetings count once in busy time, so the share never exceeds 100%.
- **Daily chart:** meeting hours for each day, rendered in ordinary HTML without external libraries. A meeting crossing midnight is split between the two days; a meeting extending beyond the period counts only for its portion within it.
- **“Most often with”:** by hours and meeting count. This uses the meeting organizer: the widget does not request attendee lists (that would require a separate request for every meeting), so one-to-one meetings are not attributed by attendee. The window explains this. Meetings you organize appear on a separate line because they have no other organizer.
- **Breakdown by platform** (Teams, Zoom, Webex, Google Meet, KTalk, other link, no link) and **your response** (accepted, tentative, organizer, unanswered).
- **Excluded:** cancelled meetings (including those with a “Cancelled:” prefix) and meetings you declined. All-day entries count as days, not hours; otherwise a week on call would look like 168 hours of meetings.
- **Data source.** The widget keeps only the previous 7 days and next 30 days in memory, so meetings for the selected period are requested separately using one `GetCalendarView`, the same request used for normal synchronization. The period is validated before the request: at most 60 days, no more than two years from today; one request at a time, at most 20 per 10 minutes. Nothing else is sent to the server, and data is not sent anywhere else. The response is not cached and does not replace the synchronized list: it lives only in this window.
- All calculations are in `src/shared/stats.ts`, independent of Electron and React, and covered by tests (`test/stats.test.ts`).

### Notifications

Reminders and change messages appear as Windows notifications. Their buttons work without opening the app window.

| Notification | Contents |
|---|---|
| Meeting reminder | “Meeting in N min”, title, time and organizer. A “Snooze for 5 / 10 / 15 minutes” dropdown, “Join” (an unfamiliar link's host is shown beside it) and “Snooze” buttons. If there are several meetings, “Open” replaces “Join”. Stays until you respond. |
| New invitation | Who invited you, to what and when. An “Accept” button; clicking the text opens meeting details. |
| Meeting moved or cancelled | What changed and the new time. Clicking the text opens meeting details. |

How this works and its limits:

- **“How to show the reminder” setting.** “Automatic” uses Windows notifications only for an installed copy (it has a Start menu shortcut, which Windows needs to deliver app notifications). In portable mode, this setting uses the app's own reminder window, which remains visible. “Windows notification” and “App window” explicitly select either option.
- If the system reports a failure to display a notification, the app opens its own reminder window. If Windows silently moves the notification to Notification Center (see below), the app cannot detect that.
- Windows “Do not disturb” and “Focus assist” may keep notifications in Notification Center; this is system behavior. If missing meetings is a concern, select “App window”.
- Buttons work while the app is running. A notification left in Notification Center after you quit simply starts the app when clicked.
- The log records counters only (“toast: handed to Windows”, “changes: 2 new”), without meeting titles.
- **Not tested manually on a real Windows system.** Notifications with buttons and a dropdown follow the Electron 44 documentation and have unit tests for their logic (which button does what), but have not been visually checked on a live system: Windows is unavailable in the development environment. Check an installed copy first; if something looks or works incorrectly, select “App window” and report the problem.

<p align="right"><a href="#contents">↑ Back to contents</a></p>

## F.A.Q.

### General questions

<details>
<summary><b>What is this, and how does it differ from Outlook?</b></summary>

A small app in the Windows notification area: it shows meetings from your Exchange server through OWA, reminds you about them, joins calls with one click, answers invitations, creates meetings and finds free time. It reads your calendar only, not email. It does not replace Outlook; it provides quick access to what you need during the day.
</details>

<details>
<summary><b>Which servers are supported?</b></summary>

Designed for corporate, on-premises Exchange with OWA web access: an OWA login form or integrated Windows authentication (Kerberos / NTLM). Exchange Online (Microsoft 365) and sign-in through a separate single sign-on portal (ADFS, Azure AD and similar) are unsupported and untested. In those cases the app stops and explains where it was redirected. Meeting creation, people lookup and free-time search follow the EWS documentation and have not yet been tested against a real Exchange server: create your first meeting without attendees or with only yourself.
</details>

<details>
<summary><b>Can I connect Google Calendar, iCloud or several Exchange accounts?</b></summary>

Not yet: one Exchange account only.
</details>

<details>
<summary><b>How much memory does the app use?</b></summary>

About 70–90 MB when idle and 130–150 MB with the widget window open on Windows: it uses Electron, which embeds Chromium. See [Memory](#memory).
</details>

### Sign-in and data

<details>
<summary><b>Which server address should I enter?</b></summary>

The OWA address from your browser's address bar, for example `mail.company.ru`. An email address (`name@company.ru`) is not valid and is rejected immediately. The default is `owa.alfabank.ru`; Settings opens on first launch so you can replace it.
</details>

<details>
<summary><b>Do I need a login and password?</b></summary>

Not necessarily. Leave both fields empty to use your Windows account (Kerberos / NTLM). If supplied, credentials are used in the same form as for OWA (for example, `DOMAIN\login`). After an incorrect password, the app makes one attempt and stops synchronization until you change the settings, to avoid locking your domain account.
</details>

<details>
<summary><b>Where does my data go? Is there telemetry?</b></summary>

With MCP disabled, calendar data and credentials go only to the Exchange server in Settings. The source code also has opt-in [read-only MCP](MCP.en.md), not yet in release 1.4.4: a connected client may forward permitted meeting data to its provider; credentials remain excluded. The manual “Check for updates” button separately asks GitHub for a release version, without calendar data or authentication. There are no update requests until you click it, no telemetry and no automatic installation. Interface pages cannot make network connections. People suggestions, attendee availability, meetings for statistics, newly created meetings and invitation responses also go only to that server. Meeting search is local. See [Security](#security) and [SECURITY.en.md](../SECURITY.en.md).
</details>

<details>
<summary><b>Where is the password stored?</b></summary>

In your Windows profile, encrypted with DPAPI and stored with the server address it belongs to: the app will not send it to another server. If encryption is unavailable, the password is not saved at all. The meeting cache is encrypted in the same way.
</details>

### Installation and updates

<details>
<summary><b>Windows SmartScreen warns about the installer. Is that expected?</b></summary>

For now, yes: the installer is not Authenticode-signed. Download only from this repository's [Releases](https://github.com/dmitrbrvsk/win-owa-widget/releases), compare the file's checksum with `SHA256SUMS.txt` (commands in [SECURITY.en.md](../SECURITY.en.md)), and only then choose “More info” → “Run anyway”.
</details>

<details>
<summary><b>Installer or portable archive?</b></summary>

The installer (`OWA-Widget-Setup-*.exe`) installs in your user profile without administrator rights, creates a Start menu shortcut (required for Windows app notifications), and can be removed through “Settings → Apps”. The portable archive (`OWA-Widget-*-portable-x64.zip`) is simply extracted and run; Windows notifications are not guaranteed, so “Automatic” mode uses the app's own reminder window.
</details>

<details>
<summary><b>How do I update the app?</b></summary>

There are no automatic updates. Download the new version and run its installer over the old one (settings and password are preserved), or extract the new portable archive: the running old version closes automatically.
</details>

<details>
<summary><b>How do I uninstall the app and remove my data?</b></summary>

For an installed copy, use “Settings → Apps”: the uninstaller removes settings, encrypted password, cache and log. For portable mode, quit the app (“Quit” in the tray menu), then delete its folder and `%APPDATA%\OWA Widget`.
</details>

<details>
<summary><b>How can I reopen the introduction?</b></summary>

Settings → Diagnostics → “Show the introduction again”. It opens automatically only on the first launch, not after updates.
</details>

<details>
<summary><b>I closed the window but the app is still running. How do I quit or disable startup?</b></summary>

Closing a window does not quit the app: it stays in the notification area (on Windows 11, the icon may be under the “^” arrow). Select “Quit” from the icon's right-click menu, or quit from Settings. Startup is controlled in Settings with “Start when I sign in to Windows”.
</details>

### Window, icon and meetings

<details>
<summary><b>What does the tray icon mean?</b></summary>

A calendar without a number: no meetings or more than 15 minutes until the next one. Blue with a number: up to 15 minutes until a meeting. Green with a number: a meeting is in progress, showing minutes remaining. Red: less than two minutes until the start; if you are attending, the icon also flashes. A yellow dot in the corner means unanswered invitations. Hovering shows the meeting title and the number of unanswered invitations. See all states in the [gallery](#interface-gallery).
</details>

<details>
<summary><b>How do I find a meeting?</b></summary>

Press Ctrl+F or `/` in the tray window. Searches titles, organizers, locations and the beginning of descriptions among loaded meetings; all search words must match. Esc closes search.
</details>

<details>
<summary><b>How do I copy a meeting title or link?</b></summary>

Right-click a meeting on the timeline for “Copy title”, “Copy link” (if available) and “Copy title, time and link”. These actions are also in meeting details.
</details>

### Creating meetings and finding free time

<details>
<summary><b>How do I create a meeting, and what happens to invitations?</b></summary>

Click “+” in the tray window or “Create meeting…” in the tray menu. Enter a subject, time and attendees (suggestions come from the Exchange address book). With attendees specified, Windows shows a dialog listing recipients before sending: invitations go out on your behalf only after you click “Send”, with “Cancel” selected by default. A meeting without attendees is saved only in your calendar. See [Creating a meeting](#creating-a-meeting) for details and limits.
</details>

<details>
<summary><b>Can I move or cancel a meeting?</b></summary>

Yes, if you organize it: open its details and use “Change” or “Cancel the meeting”. Both require confirmation in a Windows dialog, showing exactly what will change and how many people will be notified. You cannot change someone else's meeting: the organizer has not granted you that permission.
</details>

<details>
<summary><b>Can I make a meeting recurring?</b></summary>

When creating it, use “Repeat” → every day, every weekday, every week or every two weeks, ending after a number of occurrences or on a date. An existing series can only be changed as a whole; the app warns you about this.
</details>

<details>
<summary><b>Why does sending invitations require a Windows dialog instead of a button in the app?</b></summary>

It is a safeguard: the system draws the dialog and the interface page cannot press its buttons. Even if the app window were compromised, it could not send invitations without your response. The dialog shows exactly what will be sent.
</details>

<details>
<summary><b>No response arrived after “Send”. Should I click again?</b></summary>

Check your calendar and Sent Items in OWA first. If the connection dropped while the response was on its way, the meeting may already exist. The app deliberately does not retry sending automatically, to avoid sending a second invitation to everyone.
</details>

<details>
<summary><b>Why does a person show “No data” in the grid?</b></summary>

Exchange did not provide their calendar: you lack free/busy permissions, the address was not found, or the server did not respond. That person does not block “Best options”, but an option is marked less reliable. Other people's meeting titles appear only where Exchange allows them.
</details>

### Notes

New notes are stored separately for each server and sign-in identity. Switching accounts does not expose or delete another account's notes. Settings → “Delete account notes” deletes notes only for the current account and requires native confirmation.

After updating, older notes may show a warning in Settings. The old `notes.bin` file did not record its owner, so the app preserves it without opening it or assigning it to the current account. It is not removed by “Delete account notes”. Keep a private backup of `%APPDATA%\OWA Widget\notes.bin`; do not publish it. Automatic import is unavailable because the account cannot be determined reliably. Recover old notes only with a verified account and trusted local assistance.

Unreadable encrypted notes and participant-group files are preserved. Writes to the affected file are blocked until access or encryption is restored and the app is restarted. Do not delete the original to dismiss an error.

### Notifications and problems

<details>
<summary><b>A reminder did not appear. What should I check?</b></summary>

Windows “Do not disturb” and “Focus assist” can keep notifications in Notification Center. In portable mode, “Automatic” shows the app's own window. If missing meetings is a concern, choose “App window” in Settings. See [Notifications](#notifications).
</details>

<details>
<summary><b>The calendar is empty or looks wrong. What should I do?</b></summary>

Open Settings → Diagnostics → “Reset cache”: the app forgets the saved meeting list and session and loads everything again (password and settings remain). The app shows your primary calendar. If this does not help, check the log (next question).
</details>

<details>
<summary><b>Where is the log, and what does it contain?</b></summary>

Settings → Diagnostics → “Open log folder” (`%APPDATA%\OWA Widget\logs\owa-widget.log`, up to 1 MB). It contains request addresses without parameters, response codes, errors and counters. No passwords, cookies, meeting titles or contents, request bodies or recipient addresses are recorded. Internal server addresses and certificate information remain in the log. For a public report, use Settings → Diagnostics → “Copy support report”. If a log excerpt is needed for diagnosis, review it before sharing and remove internal addresses and other internal information. Do not publish the raw log.
</details>

<details>
<summary><b>How do I report a bug or vulnerability?</b></summary>

Use the [bug report form](https://github.com/dmitrbrvsk/win-owa-widget/issues/new?template=bug_report_en.yml) for bugs: include the app version, conditions, steps, expected result and actual result. If needed, attach the safe support report from Settings; review the text and attachments and remove sensitive information before posting. Do not send passwords, cookies, tokens, calendar data, internal addresses or raw logs. Use the private [Security → Report a vulnerability](https://github.com/dmitrbrvsk/win-owa-widget/security/advisories/new) form for vulnerabilities if it is available. Otherwise, open a public issue only to request a private contact method, without any vulnerability details. See the [reporting policy](../SECURITY.en.md#reporting-a-vulnerability).
</details>

<p align="right"><a href="#contents">↑ Back to contents</a></p>

## Troubleshooting

- **“Server certificate validation failed”.** The app checks certificates against the Windows store, like Edge. The message explains why validation failed (unknown authority, wrong name or expiry) and who issued it. For an internal company certificate, installing your company's root certificate in Windows is preferable. If that is impossible, select “Trust certificate”: the app remembers that fingerprint for the server and shows a native confirmation dialog.
- **“No OWA at … (HTTP 404)”** or **“does not look like Outlook Web App”.** Check the address: it must be the OWA server, not an email address or the company website.
- **“The server redirects sign-in to …”.** Sign-in goes through another portal (single sign-on), which is not currently supported. Try leaving login and password empty to sign in with your Windows account.
- **The calendar is outdated or looks wrong.** Settings → Diagnostics → “Reset cache” forgets and reloads the meeting list and server session. Password and settings are unaffected.
- **The password disappeared after changing the server address.** This is intentional: the password is bound to the server it was entered for and is not transferred to another one. Enter it again.
- **“Cannot connect to the Exchange server (ERR_…)”.** The value in parentheses is the reason reported by the Windows networking layer: `ERR_HTTP2_PROTOCOL_ERROR` or `ERR_EMPTY_RESPONSE` usually means a gateway or proxy is blocking the request; `ERR_CONNECTION_*` means the server is unreachable (check your VPN). The same text and request address are written to the log.
- **Nothing refreshes after an incorrect password.** This is intentional: the app makes one sign-in attempt and does not retry until you change the settings; otherwise repeated “Refresh” clicks could lock your domain account. Enter the password again in Settings.
- **A reminder did not appear.** Check Windows “Do not disturb” and “Focus assist”, or choose “App window” in Settings.
- **The window is blank or the error has no explanation.** Open Settings → Diagnostics → “Copy support report”, review it and attach it to a [bug report](https://github.com/dmitrbrvsk/win-owa-widget/issues/new?template=bug_report_en.yml). Use “Open log folder” to inspect the log; if you need to share an excerpt, review it first and remove internal addresses and other internal information.

<p align="right"><a href="#contents">↑ Back to contents</a></p>

## Groups, privacy and diagnostics

**Participant groups.** In free-time search, add addresses and select “Save group”. Give it a name, such as “My team”. Next time, choose it from the list to fill in the participants and start checking availability. Choosing a group replaces the current participants. To change a group's members, first edit the participants, then select “Edit” beside the selected group; you can also rename it. Deleting a group does not remove people from the current search. Up to 20 addresses and 30 groups per account; storage is local and encrypted. In demo mode, groups exist only in memory.

**Privacy mode.** Select the lock in the main window, the button in Settings, or the tray menu item. All windows switch to an anonymized calendar showing only times and availability. Select “Show meeting details” to return to meeting details, attendees and Settings. The mode persists across restarts. Enable it before screen sharing: previously copied text, Windows notification history, native dialogs and other apps are outside its scope.

**Connection test.** The button in Settings checks the current form values and shows the stages: “Server reachable”, “Certificate accepted”, “Signed in”, “Calendar received”. After a failure, later stages show “Not checked”; demo mode does not perform network checks. The test neither disables certificate validation nor replaces saving the settings.

**Support report.** Under “Diagnostics”, select “Copy support report”. Expand “Report contents” below to inspect it. The app version, OS, synchronization state and technical codes help locate the problem; server address, credentials and meeting contents are excluded. The report is never sent automatically. It is a separate safe report, not a copy of the full log.

**Update check.** Select “Check for updates” in Settings. Only then does the app contact GitHub and compare the latest stable release version with the installed one. If a newer version exists, open its page, download the appropriate installer and install manually. There are no scheduled checks or background downloads; Exchange credentials and calendar data are not sent to GitHub.

## Local MCP (not yet released)

The current source code provides optional read-only MCP access for local clients. It needs native consent and a separate Node.js 24.22+ runtime within 24.x. Titles require additional permission, and privacy mode hides them. Clients see only loaded meetings, not a complete availability result. Follow company policy before connecting an AI client. See the [MCP setup guide](MCP.en.md). Published release 1.4.4 does not include this feature.

## Security

The app is designed to be entrusted with a corporate email password, so it uses strict safeguards. Key points:

- **Exchange requests go only to your server.** Exchange requests use HTTPS to the configured host and port. A separate GitHub request is made only when you select the update-check button, without Exchange cookies or authentication. There is no telemetry or automatic installation; interface pages cannot make network connections.
- **The password** is encrypted by Windows using DPAPI, bound to its server and never sent to another one. Personal meeting notes are also stored locally in encrypted form and never sent anywhere. Changing servers, trusting an internal certificate and sending invitations require **native dialogs** that the interface page cannot operate.
- **Untrusted text.** Titles, descriptions, links and server responses are parsed in linear time, size-limited and sanitized. Only `http(s)` links can be opened; unfamiliar sites show their actual host.
- **Verifiable builds.** The installer is unsigned, but every `.exe` has a checksum and build attestation showing it was built from this repository in GitHub Actions.

See [SECURITY.en.md](../SECURITY.en.md) for the full description, downloaded-file verification, known limitations and vulnerability reporting.

<p align="right"><a href="#contents">↑ Back to contents</a></p>

## Memory

The app uses Electron, which embeds Chromium. When idle, two processes run (the main Node.js process and the network service), using about 70–90 MB on Windows. The main process draws the tray icon itself; the tray window is created on click and released three minutes after it is closed (while open, it adds about 60 MB). The GPU process is disabled: the widget has nothing to accelerate, and it would add a process and 30–40 MB. Settings, “Create meeting”, “Find free time”, “Meeting statistics” and reminder windows are created on demand and released when closed (each open window adds about 100 MB). Windows notifications do not create app windows.

<p align="right"><a href="#contents">↑ Back to contents</a></p>

## For developers

Requires Node.js 24.22.0 LTS and Yarn 4.18.1. With nvm, the commands below select the pinned Node.js version; on Windows without nvm, install this Node.js version separately. Corepack ships with Node.js 24 and selects Yarn using `packageManager`.

Dependencies are locked in `yarn.lock`; CI installs them with `yarn install --immutable`. The project uses ordinary `node_modules`. Automatic third-party package scripts are disabled with `enableScripts: false`; the Electron binary is downloaded separately with `yarn setup:electron`. The finished app uses Electron's embedded Node.js — widget users do not need to install Node.js.

### Running

```bash
nvm install
nvm use
corepack enable
yarn install --immutable
yarn setup:electron  # download Electron and verify checksums
yarn dev:demo        # fictional meetings; no Exchange required
yarn dev             # with a real account
yarn lint            # ESLint, Stylelint and formatting
yarn test            # OWA parsing, meeting logic, notifications and safeguards
yarn dist            # installer and portable .zip in release/ (on Windows)
```

Manual test cases: [TEST-CASES.en.md](TEST-CASES.en.md) — 147 checks across all screens, with preconditions, steps and expected results.

The `.exe` build runs in GitHub Actions on `windows-latest`. Version preparation and publication, release-note format and corrections to published text are covered in the [single release guide](releases/README.en.md).

### Project structure

| Folder | Responsibility |
|---|---|
| `src/main/owa/` | OWA client: sign-in, `GetCalendarView`, `GetCalendarEvent`, invitation responses, meeting creation (`CreateItem`), people lookup (`ResolveNames`), availability (`GetUserAvailability`) through EWS; XML parsing (`xml.ts`). Uses Chromium's networking stack, so Windows SSO, proxies and certificates are picked up automatically. |
| `src/main/` | Tray icon and flashing (`trayPulse.ts`), windows, synchronization, reminders, notifications (`toasts.ts`), the meeting-creation gate with confirmation and limits (`meetingGate.ts`), settings and password storage. |
| `src/shared/` | Logic independent of Electron: link detection, timeline layout, tray status, meeting-list comparison (`changes.ts`), notification text and buttons (`toasts.ts`), binding the password to a server (`secret.ts`), meeting search (`search.ts`), availability grid and “Best options” (`availability.ts`), meeting statistics calculations (`stats.ts`), address validation (`email.ts`), meeting-confirmation text (`meetingConfirm.ts`). Covered by tests. |
| `src/renderer/` | React interface. Runs with demo data in a regular browser (`yarn build:renderer`). |

## Interface gallery

Light and dark themes follow Windows. The window opens beside the tray icon.

### Tray window

<p align="center">
  <img src="screenshots/popup-light.png" width="320" alt="Tray window in the light theme: next meeting with a Join button and the day's timeline">
  <img src="screenshots/popup-dark.png" width="320" alt="Tray window in the dark theme">
</p>

<p align="center">
  <img src="screenshots/detail-light.png" width="320" alt="Meeting details: attendees, invitation response and description with links">
  <img src="screenshots/invites-dark.png" width="320" alt="New invitations at the top, dark theme">
</p>

### Replies with comments, conflicts and notes

<p align="center">
  <img src="screenshots/conflict-light.png" width="320" alt="An invitation overlapping another meeting: yellow warning and Decline button">
  <img src="screenshots/reply-light.png" width="320" alt="Replying to an invitation with a comment">
</p>

<p align="center">
  <img src="screenshots/propose-dark.png" width="320" alt="Proposing another time: new time and a comment for the organizer, dark theme">
  <img src="screenshots/note-dark.png" width="320" alt="Personal note in meeting details, dark theme">
</p>

### Meeting search

Ctrl+F or `/` in the window.

<p align="center">
  <img src="screenshots/search-light.png" width="320" alt="Meeting search, light theme">
  <img src="screenshots/search-dark.png" width="320" alt="Meeting search, dark theme">
</p>

### Meeting creation and availability grid

The “Create meeting” window and attendees' weekly availability grid with “Best options”.

<p align="center">
  <img src="screenshots/create-light.png" width="380" alt="Create meeting: subject, time, recurrence, required and optional attendees, location and description">
  <img src="screenshots/detail-organizer.png" width="300" alt="Your meeting's details: Change and Cancel the meeting buttons, attendees with responses and description">
</p>

<p align="center">
  <img src="screenshots/availability-light.png" width="760" alt="Finding free time: weekly availability grid for five people and a list of best options on the right">
</p>

<p align="center">
  <img src="screenshots/create-dark.png" width="300" alt="Create meeting window, dark theme">
  <img src="screenshots/availability-dark.png" width="460" alt="Finding free time, dark theme">
</p>

### Meeting statistics

How much time meetings take, which days have the most, and whom you meet with most often.

<p align="center">
  <img src="screenshots/stats-light.png" width="760" alt="Meeting statistics: key figures, daily hours, who you meet with and call-platform breakdown">
</p>

<p align="center">
  <img src="screenshots/stats-dark.png" width="760" alt="Meeting statistics, dark theme">
</p>

### Tray icon

Different states: light taskbar on the left, dark taskbar on the right, with the icon at its actual size alongside.

<p align="center">
  <img src="screenshots/tray-states.png" width="760" alt="Icon states: no meetings, 12 minutes to a meeting, meeting in progress, unanswered-invitation dot, and two flashing frames two minutes before the start">
</p>

### First-run introduction

Four steps: where to find the icon, how to connect, what is inside and how reminders work. Opens once and can be closed at any step; available later in Settings.

<p align="center">
  <img src="screenshots/welcome-light.png" width="360" alt="First introduction step: where the app's icon lives">
  <img src="screenshots/welcome-dark.png" width="360" alt="Last introduction step, dark theme">
</p>

### Reminder and settings

<p align="center">
  <img src="screenshots/reminder-light.png" width="360" alt="The app's reminder window above the taskbar, light theme">
  <img src="screenshots/reminder-dark.png" width="360" alt="The app's reminder window, dark theme">
</p>

<p align="center">
  <img src="screenshots/settings-light.png" width="400" alt="Settings: OWA address, sign-in, reminders and notifications, theme, diagnostics and cache reset">
</p>

<p align="right"><a href="#contents">↑ Back to contents</a></p>
