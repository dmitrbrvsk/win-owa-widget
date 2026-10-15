# Security

[Русский](SECURITY.md) | English

## How to verify a downloaded file

The installer is not yet signed with a Windows certificate, so SmartScreen may warn about it. Before running it, check the file against the release:

```powershell
Get-FileHash .\OWA-Widget-Setup-<version>.exe -Algorithm SHA256
```

The result must match the corresponding line in `SHA256SUMS.txt` on the release page. Each `.exe` also has a build attestation: it shows that the file was built from this repository by its GitHub Actions workflow rather than uploaded manually.

```powershell
gh attestation verify .\OWA-Widget-Setup-<version>.exe --repo dmitrbrvsk/win-owa-widget
```

Download only from this repository's [Releases](https://github.com/dmitrbrvsk/win-owa-widget/releases) page.

## New local features

- **Participant groups:** up to 30 groups per account, with up to 20 addresses per group; `groups.bin` is encrypted with `safeStorage` (DPAPI on Windows). Writes are rejected when encryption is unavailable. Groups are bound to the server and sign-in method / login; addresses are not sent to third-party services. Availability checks for the selected participants go to Exchange.
- **Privacy:** enabled manually and preserved between launches. All widget windows show only calendar times and overall availability; meeting details, forms, names, addresses and notes are hidden. New reminders and the tray tooltip use anonymized events. Existing notifications are closed where possible. This mode cannot clear or hide Windows notification history, the clipboard, open native dialogs or third-party apps — enable it before screen sharing.
- **Support report:** a separate allowlist of fields: version, OS/architecture, time, synchronization phase, results of the four connection stages, error category, HTTP status and a known technical code. It contains no server address, login, password, cookies, certificate, paths, error text or meetings. Use Settings → Diagnostics → “Copy support report”; “Report contents” lets you inspect it. It is sent only manually.
- **Updates:** one GET request to this repository's fixed releases API, only when you click. A separate session without cookies or credentials, no redirects, a 10-second timeout and a response limit of 128 KB. Only stable numeric versions are compared. Only a validated release link for this repository can be opened. The browser then opens GitHub normally; downloading and installation remain manual.

## How the app handles your data

- With MCP disabled, calendar data and credentials are sent only to the Exchange server configured in Settings. The opt-in MCP exception is described below; it never exposes credentials. The separate exception is the manual “Check for updates” button: it requests the latest release from `api.github.com`. There are no update requests before you click, no telemetry and no automatic installation. Interface pages disallow all network connections (`connect-src 'none'`).
- Exchange requests use HTTPS and stay on the same server. The initial request, every redirect and every authentication request must use `https://` and the configured host **and port**. An address using `http://`, another host or another port is rejected before sending, so the password and session are not sent to another server or in cleartext.
- The password is encrypted by Windows using DPAPI and stored in the user profile. If encryption is unavailable, the password is not saved at all. The meeting cache uses the same encryption.
- **The password is bound to its server.** The encrypted file stores the password with the server address it was entered for. The app will not send it to any other address, even if the settings file has been changed. A password saved by a version before 0.2.0 (which did not store the server alongside it) is not used and is deleted on first launch; it must be entered again. Binding it to the current address in the settings file would send it to a server the user had not confirmed.
- **Changing servers requires a native confirmation dialog.** Specifying another server means sending it the login, password and, when the login is empty, Windows account authentication data. Saving settings or testing a connection with a new address therefore opens a Windows dialog that the interface page cannot operate. The old password is not transferred to the new server: it must be entered again. At most one such dialog can be open at a time.
- Integrated Windows authentication (Kerberos / NTLM) is allowed only for your server, checking both host and port.
- The login and password are sent only to the server's own OWA login form (`…/auth.owa` on the specified server, over HTTPS, from the same address), and only if the server actually displayed that form. A 404 page, portal or proxy login form does not receive the password: the app stops and explains what it found. An email address in the server field is rejected immediately.
- An incorrect password allows one attempt; after that, the app does not sign in again until a retry is confirmed in Settings — not on a schedule, through “Refresh”, or at the request of an interface window. Several failed sign-ins can lock a domain account; neither a hurried user nor a looping page should be able to consume those attempts.
- Certificates are checked against the Windows certificate store. Trusting an internal certificate requires a native dialog showing its fingerprint; the app remembers that exact fingerprint for that host. The page cannot confirm trust itself.
- People suggestions during meeting creation, attendee availability, meetings requested for statistics and meeting operations go **only** to the configured Exchange server, using the same protected channel as other requests (HTTPS, matching host and port, certificate validation). Meeting search and the “Copy” context menu work locally: the search query is neither sent anywhere nor written to the log.
- **Personal meeting notes** are stored only in an encrypted profile file, using the same mechanism as the cache. They are not sent to Exchange or anywhere else, through requests or the log. If encryption is unavailable, the note is not saved and the user is notified. Limits: up to 5000 characters per note, at most 500 notes and 60 writes per minute. A note is accepted only for a meeting in the synchronized list; notes for meetings more than 92 days old are deleted automatically. “Delete account notes” in Settings requires native confirmation.
- “Reset cache” (Settings → Diagnostics) deletes the saved meeting list and server session. Password, certificate and settings remain.
- Administrator rights are required neither for installation nor for use. Uninstalling through the installer removes settings, encrypted password, cache and log.

## Local MCP (unreleased source code)

MCP is off by default. Enabling reading or widening title access requires a native confirmation; disabling takes effect immediately. Only loaded meeting times/status and optionally titles are exposed. Privacy mode hides titles and disables title search. No attendees, descriptions, locations, links, notes, Exchange ids, credentials or write operations are exposed. Account changes revoke access.

The standard MCP transport is stdio through a separate Node 24.22+ CLI. An internal authenticated loopback bridge has strict Host/Origin checks, bounded input/output and timeouts. Connection secrets never enter the interface or copied configuration. Requests and request-bound responses use AES-256-GCM with fresh nonces. Windows protection depends on inherited user-profile ACLs; code running as the same user or administrator can read the key. This does not protect against a compromised user account.

**Enabling MCP allows calendar data to leave the widget for the connected client.** That client may send it to its AI provider or log it. Previously delivered data cannot be recalled. Check company policy and client settings before granting access. Setup, limitations and safe troubleshooting: [MCP guide](docs/MCP.en.md). This feature is not included in the published 1.4.4 release.

## Audit fixes in unreleased source

- Certificate approval is bound to the exact displayed host, fingerprint and account revision; changes during the native dialog invalidate approval.
- The real transport authentication mode matches local data ownership. If a manual sign-in password becomes unavailable, the connection stops without falling back to Windows SSO.
- Meeting notes have encrypted account ownership. Ownerless legacy `notes.bin` is preserved without reading or automatic import; see [Notes](docs/GUIDE.en.md#notes). Unreadable notes and participant groups cannot be overwritten by a subsequent save.
- Server JSON is checked before materialization: up to 48 nesting levels, 1024 properties per object, 6000 array items and 200000 structural tokens, in addition to the HTTP byte limit. Walkers also bound actual visited nodes and array work. Oversized structures are rejected rather than freezing the app.
- The MCP bridge keeps a separate pre-authentication concurrency limit. Only authenticated valid envelopes consume the 120-requests-per-minute operation budget. Each connection has an absolute three-second deadline, including slow headers and body delivery.

## Untrusted text

Meeting titles, descriptions, locations, links and server pages come from people you cannot trust unconditionally. Therefore:

- Messages and pages are parsed in linear time with limits: link detection, HTML-to-text conversion and login-form parsing do not use regular expressions that take seconds on specially crafted input. Text size, meeting count (3000), attendees and hidden form fields are limited. A malicious invitation cannot freeze the app.
- Titles, organizers, locations and descriptions have control characters, text-ordering characters (including direction marks) and invisible zero-width characters removed, and are truncated to a maximum length. They cannot inject log lines, menu items, confirmation dialogs or notifications. Invisible text is removed so it cannot conceal what the user is reading.
- Only `http(s)` links can be opened, without a login in the address or hidden characters. A window can open only a link the app supplied to it: the meeting's call link or links the app detected in its location and description. The window cannot open any other link, so it cannot use the browser as an outbound channel. Raw message HTML is not passed to the interface window. Cached data on disk is validated on load as strictly as a server response.
- A link is opened only after it has been shown: the “Join” button displays the actual host beside it for unfamiliar sites, while known services show it in a tooltip. The app does not open links on its own.

## Notifications

- A notification carries no action data: the pressed button is returned as an index in the list built by the app, and the action uses the main process's state. A button press cannot be forged from outside the app.
- “Accept” is available only on a new-invitation notification and sends only an acceptance for that meeting, just like the button in the window. The app then reports success or failure.
- At most six change notifications per hour are shown; bulk changes produce one summary. The server cannot flood you with notifications.
- If a Windows notification cannot be displayed, the app's own reminder window is shown.

## Creating, changing and cancelling meetings; free time

These features send messages on your behalf and have stricter safeguards than the others. Everything below about creating a meeting also applies to changing or cancelling it: the same main-process path, checks, limits and native dialog.

- **A reply with a comment or “Propose another time” also sends a message on your behalf.** It follows the same path as creation and changes: one send at a time, validation in the main process, shared limits and a native confirmation dialog with the full reply text (“Cancel” by default and on Esc). The app checks that it is someone else's invitation, not cancelled, with a known change key. The comment is sanitized and limited to 1000 characters; the proposed time must be a valid interval of at most 12 hours, not in the past or more than a year away. Text goes only into `NewBodyContent` of a normal invitation response; it is neither a separate email nor an Outlook counterproposal.
- **Changes and cancellations also send notifications.** Moving a meeting notifies all invitees; cancelling it sends a notice to everyone, including anyone just removed from the list. Both therefore require native confirmation: the change dialog shows exactly what changes (old and new times, added and removed attendees); the cancellation dialog shows how many people will be notified and that the meeting cannot be restored. The safe response is selected by default and used on Esc.
- **The main process decides what changed.** It reads the previous meeting from the synchronized list and server, compares it with the window's input and sends only differing fields. The window cannot claim a change that did not happen or supply its own “previous” meeting state to the confirmation dialog.
- **Recurrence is limited:** at most 100 occurrences and no more than two years ahead. The confirmation dialog shows the occurrence count because each occurrence is an entry in someone else's calendar.
- **Native confirmation.** With attendees present, invitations are sent only after “Send” is selected in the Windows dialog. The main process builds the text from the validated meeting (subject, time, location, beginning of the description, and recipients: the first 15 followed by “and N more”), rather than accepting it from the interface. “Cancel” is the default and the Esc action. When a subject, location or description does not fit in full, the truncated line is followed by its total character count: shortening the display cannot silently conceal the length of what will be sent. The page cannot press this dialog's buttons, so even a compromised interface window cannot send invitations. A personal meeting without attendees also requires confirmation before saving: unconfirmed content cannot authorize its own external links.
- **Main-process check order:** one send at a time → validate every field (window data is untrusted) → limits → confirmation → check limits again (time passes while the dialog is open) → request. Shared limits for creation, changes and cancellations: at most 10 operations and 300 recipients per hour, 12 confirmation dialogs per 10 minutes, 100 addresses in each of the two lists (required and optional), 500 characters each for subject and location, 20,000 for the description, a meeting length of at most 7 days, and a date no more than two years from today.
- **Ordinary addresses only.** Recipient addresses must use ASCII characters (Latin letters, digits and ordinary punctuation). Addresses with lookalike characters from other alphabets, spaces, angle brackets or control characters are rejected before confirmation and before a request. A request is not built from an address that failed validation, even if the calling code skipped the check.
- **Exchange requests are built without allowing markup injection.** Every inserted value is escaped (`& < > " '`); characters invalid in XML and unpaired surrogates are removed. A subject such as `</Subject><Evil/>` therefore stays text. Times are sent as exact UTC instants, so daylight-saving changes do not shift them.
- **Strict server-response parsing.** “Created”, and likewise “invitation response sent”, counts as success only with an explicit `ResponseClass="Success"`, regardless of namespace prefix. Error pages, empty responses, other markup and truncated responses are not success, and the user is not told that an unsuccessful operation succeeded. The app builds error messages from response codes; server text is not passed to the interface or log. XML parsing is single-pass, without a DOM or entity expansion (document type declarations are skipped), with limits on response size (at most 8 MB), token count and name length, so malicious responses cannot freeze the window or exhaust memory.
- **Only the organizer can change or cancel a meeting.** The app checks this itself rather than trusting the window; an already cancelled meeting cannot be cancelled again.
- **No automatic resend.** If the connection drops while a response is on its way, the app does not resend the request (everyone would receive another invitation) and asks you to check your calendar first. The only exception is creating a meeting with no attendees, where no messages were sent: if the server says it does not recognize the computer's time zone, the meeting is saved by retrying without a time zone. Changes and cancellations are never retried. With attendees present, even this case is not retried: a server's claim that it rejected the time zone is not proof that invitations were not sent.
- **Address-book suggestions:** at most 60 requests per minute; the query is length-limited and sanitized. At most 8 people are taken from a response, with valid SMTP addresses only (legacy X.500 addresses cannot be inserted into invitations); names have control characters and hidden text-direction characters removed.
- **Availability:** at most 20 addresses and 14 days per request, no more than three years from today; the app sets the requested interval itself. One request at a time, at most 30 per 10 minutes. Responses are parsed in linear time, with limits on people, intervals and availability-string length; unknown characters mean “No data”. Other people's meeting titles are sanitized and displayed only where Exchange returned them (private ones are not shown).
- **Meeting statistics:** the window requests meetings for a period with a single `GetCalendarView`, the same request as normal synchronization, without additional fields. The period is validated before requesting (at most 60 days, no more than two years from today); one request at a time, at most 20 per 10 minutes. The response is not cached and does not replace the synchronized list; all calculations stay on your machine and their contents are not sent out.
- **Other requests are limited too.** Opening meeting details and responding to invitations: at most three concurrent requests and 120 per 10 minutes; people suggestions: 60 per minute; availability: one request at a time and 30 per 10 minutes; statistics-period meetings: one request at a time and 20 per 10 minutes; “Copy” menu: 20 openings per minute. A looping page cannot turn into a stream of requests on your behalf.
- **The log** records only outcomes and counters (“created, invited 3”, “requested 4 mailboxes, 4 responded”), without addresses, subjects or text.
- `OWA_E2E_AUTOCONFIRM` (automated-test responses to native dialogs for sending, invitation replies and deleting notes) and `OWA_POPUP_IDLE_MS` (how long a hidden widget window is kept before release) work only in development builds; installed and portable builds ignore them.

## Diagnostic log

The log in your user profile (`%APPDATA%\OWA Widget\logs\owa-widget.log`, up to 1 MB) contains request addresses without parameters, response codes, certificate-error reasons, window events, calendar-change counts and notification counts. It contains no passwords, cookies, canary values, headers, response bodies or meeting titles and contents. Each entry occupies one line: server-response or certificate text cannot inject additional lines into the log. The log is never sent anywhere; use Settings → Diagnostics → “Open log folder” to open its folder.

## Application safeguards

- The main process draws the tray icon and tooltip from the calendar data it already holds. The tray window cannot set the icon or tooltip: no such channel exists. The window is created on click and closed three minutes after being hidden; it uses the same sandbox as other windows.
- Windows are sandboxed (`sandbox`, `contextIsolation`, no `nodeIntegration`); they cannot open new windows, navigate to external addresses (including from nested frames) or request permissions.
- The main process responds only to its own interface page and validates every argument: settings are reconstructed field by field, numbers are bounded, and actions and addresses are checked. The main process itself limits icon flashing to 150 seconds per sequence and only during the countdown. It also builds the right-click “Copy” menu: the page sends only a meeting ID, while clipboard text comes from data already held by the main process.
- Installed builds disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, `--inspect`, DevTools, demo mode and the dev server. The app loads only from `app.asar`, whose integrity is checked against the hash inside the `.exe`: a modified archive will not start.
- GitHub Actions builds the app: dependencies and actions are pinned by hashes; package installation disables scripts (`yarn install --immutable` with `enableScripts: false`); the build does not use a dependency cache; build steps receive no write-enabled token; a separate job publishes the release. After building, CI starts the resulting `.exe` and checks that windows opened and the log has no errors.

## Known limitations

- The installer is unsigned (an Authenticode certificate is needed). Until signing is available, use the verification steps above: `SHA256SUMS.txt` also has an attestation, so replacing both the installer and its checksum list cannot go unnoticed when verified.
- The app installs in your user profile, so anything running as you can write to its files. `app.asar` integrity checks and disabled fuses protect against replacing the code archive, but not the `.exe` itself: both the hash and fuses are stored inside it.
- Protection against programs running **under your account** is limited. DPAPI protects the password from other users of the computer, but a program running as you can call DPAPI on your behalf. It can also change the settings file (server address, pinned certificate) without the native confirmation dialog. The saved password remains bound to the original server, but Windows authentication with an empty login will use whichever server is in the file. This follows the Windows user-data protection model.
- A link in an invitation can lead to an attacker's site if the attacker sent it. As in Outlook, check who sent the message and where the link goes (the host appears in the tooltip, and unfamiliar sites also show it on the button).
- Some development-tool dependencies (not included in the finished app) have known moderate-severity Yarn audit advisories; they do not enter the installer. High and critical advisories anywhere in the dependency tree, including Electron itself, stop the build.
- A program running **under your account** can contact the server in the same way as the app, including creating a meeting. Confirmation protects against accidental or manipulated sends from the app's own windows, not code already running as your user.
- Windows notifications with buttons, the native sending-confirmation dialog, flashing in the real Windows tray and Windows authentication against real Exchange have not been tested, nor have **meeting creation, people suggestions and free-time search against real Exchange**. Test the app on your own server first, and create your first meeting without attendees.

## Reporting a vulnerability

Use the private [Security → Report a vulnerability](https://github.com/dmitrbrvsk/win-owa-widget/security/advisories/new) form if it is available for this repository. If the private form is unavailable, open a public issue only to request a private contact method, without vulnerability details, reproduction steps, secrets or sensitive attachments. Please do not publish vulnerability details in public issues until a fix is released.


### Calendar session isolation

Every connection-settings change invalidates previous requests and cancels the old client's network activity. Results and errors are accepted only from the current session. The calendar cache contains an encrypted account identifier; the old format without an owner is recreated after connecting to Exchange. Switching accounts closes meeting-detail, search, reminder and draft windows from the previous session.

The sign-in block after an incorrect password applies to all calendar operations. Failure to read optional local files does not prevent startup. An unreadable notes file is preserved, and writes to it are blocked until access is restored and the app is restarted.


A full connection reset clears both cookies and Chromium's separate HTTP authentication cache; open connections are closed before the new session starts. The log of blocked navigation and new-window attempts stores only the origin, without a meeting link's path, parameters or fragment. The diagnostic log may still contain internal server addresses and certificate information: review it before sharing publicly. Use the safe report in Settings for public reports.

### Findings from the deeper audit (1.4.3)

Personal meetings without attendees also require native confirmation when created, changed or cancelled. An unconfirmed entry cannot add its own link to the list of addresses allowed to open in the browser.

After an authentication error, clearing the cache, recreating the client or performing certificate operations does not lift the sign-in block. Retesting the connection or saving corrected credentials requires native confirmation; it can be requested at most once every 30 seconds. Cancelling or failing to save does not authorize another sign-in. A successful test with saved credentials resumes synchronization; testing a password that has not yet been saved does not authorize automatic attempts with the old password. The restriction applies in the current process and does not replace domain policy.

### Isolated interface origin (1.4.4)

All windows use the internal `owa-widget://app/index.html` scheme; no local HTTP server or Windows link registration is created. The scheme is available only inside the app and serves a single HTML page and bundled JS/CSS from the renderer directory. Other files, hosts, write methods, external initiators, links outside the directory and source maps are rejected. Extra `file://` privileges are disabled with the `grantFileProtocolExtraPrivileges: false` fuse; IPC from file URLs is no longer accepted. CSP, sandboxing and context isolation remain in place; CSP bypass and service workers are not allowed.

The packaged CI build must not merely start: it must confirm that the interface loaded with styles and a working preload bridge. Its ready message contains only a constant technical marker, without calendar contents.
