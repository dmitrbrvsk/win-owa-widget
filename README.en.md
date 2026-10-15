<h1 align="center">OWA Widget</h1>

<p align="center"><a href="README.md">Русский</a> · English</p>

<p align="center">
  <a href="https://github.com/dmitrbrvsk/win-owa-widget/actions/workflows/build.yml?query=branch%3Amaster"><img src="https://github.com/dmitrbrvsk/win-owa-widget/actions/workflows/build.yml/badge.svg?branch=master" alt="Build on master"></a>
  <a href="https://github.com/dmitrbrvsk/win-owa-widget/releases/latest"><img src="https://img.shields.io/github/v/release/dmitrbrvsk/win-owa-widget" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
</p>

<p align="center"><strong>Your next meeting, right beside the Windows clock.</strong></p>
<p align="center">Your Exchange calendar in the tray: a daily schedule, reminders<br>and one-click joining without opening Outlook.</p>

<p align="center">
  <a href="https://github.com/dmitrbrvsk/win-owa-widget/releases/latest"><strong>Download for Windows →</strong></a>
  &nbsp; · &nbsp; <a href="#install-and-connect">Get started</a>
  &nbsp; · &nbsp; <a href="docs/GUIDE.en.md">Guide and FAQ</a>
  &nbsp; · &nbsp; <a href="CHANGELOG.en.md">Changelog</a>
</p>

<p align="center"><sub>Windows 10/11 · x64 and ARM64 · English / Russian · No administrator rights required</sub></p>

**Compatibility:** corporate Exchange on-premises with OWA. Microsoft 365 / Exchange Online, modern OAuth authentication and separate SSO portals are not supported. EWS must be available for meeting creation, people lookup and free-time search.

**Current validation:** CI runs tests, builds the Windows app and checks that its windows open. Authentication, EWS operations and Windows notification buttons still need validation in a real corporate environment. Some native server/certificate dialogs and error messages still use Russian; the guide explains their meaning. See the [compatibility details and limitations](docs/GUIDE.en.md#general-questions).

<p align="center">
  <img src="docs/media/hero.png" width="1200" alt="OWA Widget: the schedule, next meeting and Join button in light and dark themes">
</p>

OWA Widget lives in the Windows notification area. Check what is next, reply to an invitation or find a shared time with colleagues in a compact tray popup. The app reads your calendar, not your email.

## Features and demos

The app supports English. The existing screenshots and animations show the Russian interface; choose **Settings → Language → English** to use English labels.

### 01 / See your day and join a meeting

The next meeting stays at the top, with the daily timeline below it. Overlapping meetings appear side by side, and a red line marks the current time. Press **Ctrl+F** or **/** to search your loaded calendar. **Join** opens the meeting link in your browser.

<p align="center">
  <img src="docs/media/day-to-call.gif" width="1000" alt="Demo: daily schedule, local search, meeting details and the Join button">
</p>

The tray icon shows minutes until a meeting starts or ends. A reminder appears before the start as a Windows notification with buttons or a separate app window.

<details>
<summary><strong>Open a larger calendar window</strong></summary>

Choose **Calendar…** from the tray menu or use the expand button in the widget. The schedule appears on the left and the selected meeting's details on the right. Resize the window or move it to another monitor; closing it leaves the app in the tray. Search and date selection use meetings already loaded by the widget.

<p align="center">
  <img src="docs/media/calendar-light.png" width="1200" alt="Large calendar window with the daily schedule beside selected meeting details">
</p>

</details>

### 02 / Manage invitations

New invitations are grouped together. Accept, reply with a comment or propose another time. The app warns if an invitation overlaps a meeting you have already accepted. You can also keep a personal note in the meeting card.

<p align="center">
  <img src="docs/media/invitation-light.png" width="390" alt="Invitation with a scheduling conflict warning and response buttons">
  &nbsp;
  <img src="docs/media/reply-dark.png" width="390" alt="Replying to the organizer with a comment in the dark theme">
</p>

Comments and proposed times are sent to the organizer after a native confirmation dialog. A proposed time is included as text in the reply; it does not automatically move the organizer's calendar event. Personal notes stay on your computer.

### 03 / Find a time for your team

Add colleagues from the Exchange address book or select a saved group such as **My team**. Set the duration and view everyone's free/busy grid. The widget suggests suitable slots; selecting one carries the time and participants into a new meeting form.

<p align="center">
  <img src="docs/media/find-a-time.gif" width="1100" alt="Demo: selecting the saved My team group and finding a shared 45-minute slot for three participants">
</p>

Create recurring meetings, reschedule your own meetings or cancel them. A native confirmation shows the recipients and details before invitations or updates are sent. Personal appointments also require confirmation before a calendar write.

### 04 / Hide meeting details before sharing your screen

Click the lock at the bottom of the widget. Titles, names, addresses and notes are hidden across the app's windows, while times and busy periods remain visible. Toggle privacy off to restore the full calendar.

<p align="center">
  <img src="docs/media/privacy-mode.gif" width="400" alt="Demo: privacy mode hides titles and names while preserving meeting times and busy periods">
</p>

<details>
<summary><strong>Connection checks, updates and support reports</strong></summary>

Connection diagnostics show four stages: server → certificate → sign-in → calendar. Preview and copy a safe support report from Settings. Update checks contact GitHub only when you click the button; downloading and installing an update remain manual.

<p align="center">
  <img src="docs/media/settings-connection-light.png" width="390" alt="Connection settings and four diagnostic stages, marked Not checked in demo mode">
  &nbsp;
  <img src="docs/media/settings-updates-light.png" width="390" alt="Manual update checks and the safe support report controls">
</p>

</details>

<details>
<summary><strong>Meeting statistics</strong></summary>

See how much time meetings take over a week or month, which days are busiest and whose meetings you attend most often.

<p align="center">
  <img src="docs/media/stats-light.png" width="1040" alt="Weekly meeting statistics: hours by day, workload, organizers, call platforms and invitation responses">
</p>

</details>

<sub>Media was captured from the real React interface in browser demo mode. All meetings and participants are fictional; no Exchange connection or invitation sending takes place during capture. Fonts and native Windows dialogs may look different. See the <a href="docs/media/README.en.md">media notes</a>.</sub>

## Install and connect

1. Open the **[latest release](https://github.com/dmitrbrvsk/win-owa-widget/releases/latest)** and choose a file:

   | File | Purpose |
   |---|---|
   | `OWA-Widget-Setup-<version>.exe` | Windows x64 installer; also runs on ARM64 through emulation |
   | `OWA-Widget-Setup-<version>-arm64.exe` | Native Windows ARM64 installer |
   | `OWA-Widget-<version>-portable-x64.zip` | No installation: extract and run `OWA Widget.exe` |

2. The installer is **not Authenticode-signed**, so Windows SmartScreen may warn. Before running it, compare its SHA-256 hash with `SHA256SUMS.txt` from the release and verify the build attestation. See the [verification commands](SECURITY.en.md#how-to-verify-a-downloaded-file).
3. Start the app and find its tray icon; on Windows 11, it may be under the **^** arrow. No administrator rights are required. If the interface is in Russian, choose **Настройки → Язык → English** (Settings → Language → English).
4. In Settings, enter your company's OWA server, such as `mail.company.ru`, rather than your email address. Replace the default `owa.alfabank.ru` with your own server.
5. Leave both username and password empty for Windows authentication, or enter your OWA credentials. Connect to your corporate VPN if needed.

Updates are manual: download a newer release and run its installer over the existing copy. Portable mode uses an app reminder window by default because Windows notifications are not guaranteed without an installed shortcut. See the [installation and update FAQ](docs/GUIDE.en.md#installation-and-updates).

## Your calendar stays on your server

| Data | How the app handles it |
|---|---|
| Meetings and participants | Calendar requests go to the configured Exchange server over HTTPS |
| Password | Encrypted with Windows DPAPI and bound to the server |
| Local cache and notes | Encrypted on disk; notes are not sent to Exchange |
| Meeting search | Runs locally over already loaded events |
| Participant groups | Encrypted locally, separately for each account |
| Update checks | An explicit button requests the latest version from GitHub without calendar data or credentials; installation is manual |
| Telemetry | None |

Changing the server, trusting an internal certificate and writing meetings require native confirmations. See the [security model and limitations](SECURITY.en.md).

Privacy mode is available from the lock button, Settings and the tray menu. Connection diagnostics and **Copy support report** are available in Settings. Review the report before sharing it; raw diagnostic logs may contain internal server addresses or certificate details and need redaction.

## In development: local MCP

The source code includes a basic integration with local MCP clients. It is not yet part of the published 1.4.4 release. Access is off by default and requires native consent; meeting titles need a separate permission. Privacy mode also hides titles from MCP.

A client reads only already loaded meetings and cannot change the calendar. A connected AI client may send this data to its provider: follow your company policy. The adapter needs a separate Node.js 24.22+ runtime within 24.x. [Connection setup and limits](docs/MCP.en.md).

## Documentation and support

All of the following documents are available in English:

- **[Guide and FAQ](docs/GUIDE.en.md)** — features, compatibility, setup, updates and troubleshooting.
- **[Changelog](CHANGELOG.en.md)** — changes in each released version.
- **[Security and file verification](SECURITY.en.md)** — data handling, download checks, limitations and vulnerability reporting.
- **[Manual test cases](docs/TEST-CASES.en.md)** — prerequisites, steps and expected results for 147 cases.
- **[Linting and formatting](docs/LINTING.en.md)** — contributor commands and preset adaptations.
- **[Release instructions](docs/releases/README.en.md)** and **[release notes template](docs/releases/TEMPLATE.en.md)** — the publishing process and English release notes.
- **[Media notes](docs/media/README.en.md)** and **[dependency patch notes](.yarn/patches/README.en.md)** — how the demos were made and why the local patch exists.
- **[MIT license](LICENSE)**.

**[Report a bug in English](https://github.com/dmitrbrvsk/win-owa-widget/issues/new?template=bug_report_en.yml)** with the app version, Windows version and architecture, installation type, and reproduction steps. Use a reviewed support report when useful. Do not publish credentials, meeting data, internal addresses or unredacted logs. Report vulnerabilities through the process in the [security policy](SECURITY.en.md#reporting-a-vulnerability).

## Credits

Thank you to [@ilyabazhenov](https://github.com/ilyabazhenov), the creator of [mac-owa-widget](https://github.com/ilyabazhenov/mac-owa-widget), for the idea and inspiration.

His Exchange calendar widget for macOS inspired this Windows counterpart. The Windows version was written anew using Electron, React and TypeScript.

## For developers

Use **Node.js 24.22.0 LTS** and **Yarn 4.18.1** through Corepack. Versions are pinned in `.nvmrc`, `.node-version` and `package.json`; CI uses the same Node.js version.

The app uses Electron, React and TypeScript. The main process handles Exchange, storage, the tray and windows. The renderer communicates through preload/IPC; shared calendar logic is separate from Electron.

```sh
git clone https://github.com/dmitrbrvsk/win-owa-widget.git
cd win-owa-widget
nvm install
nvm use
corepack enable
yarn install --immutable
yarn setup:electron
yarn dev:demo
yarn typecheck
yarn lint
yarn test
yarn build
```

If you do not use nvm, install the Node.js version pinned in `.nvmrc` before running Corepack. The demo uses fictional meetings and needs no Exchange account. `yarn dev` uses a real account. Run `yarn dist` on Windows to build installers and the portable archive.

See the [developer guide](docs/GUIDE.en.md#for-developers), [release instructions](docs/releases/README.en.md) and [linting guide](docs/LINTING.en.md) before contributing.
