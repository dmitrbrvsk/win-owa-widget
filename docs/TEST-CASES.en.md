# OWA Widget for Windows — manual test cases

[Русский](TEST-CASES.md) | English

## About the app

OWA Widget is a small application in the Windows notification area (system tray). It shows meetings
from corporate Exchange through OWA: a day timeline in the window beside the tray icon,
a countdown on the icon itself, reminders, one-click joining, invitation responses,
meeting creation, and a search for times when attendees are free.

The app reads the calendar, not mail. Calendar operations and credentials go only to the Exchange
server configured in Settings. A separate request to GitHub happens only when you click
**Check for updates**. There is no telemetry, scheduled update check, or automatic installation.

For product details, see the [README](../README.en.md), [user guide](GUIDE.en.md), and
[security model](../SECURITY.en.md). Select English in **Settings → Language** when testing the
English interface. Labels below follow the English UI; native confirmation dialogs and some
server error messages may still be in Russian, so their actions and messages are described in English.
Test IDs are deliberately unchanged so reports can be matched to either language.

## What a tester needs

| Requirement | Purpose |
|---|---|
| A Windows 10 or Windows 11 computer (x64) | The target system. State explicitly if you use ARM64: it has not been validated there. The x64 installer runs under emulation; the native installer is `OWA-Widget-Setup-<version>-arm64.exe`. |
| Access to a corporate OWA server (on-premises Exchange) | The main scenario. You need the server address shown in the browser address bar, for example `mail.company.com`. |
| An active corporate network connection or VPN | The server is unavailable without it; VPN failures also have their own test cases. |
| A second mailbox, belonging to a colleague or test account | To send yourself invitations, move and cancel meetings, and check availability. |
| Access to OWA in a browser | To compare the app's calendar with the server's calendar. |
| A second monitor and the ability to select 150% display scaling | To test window placement. |

The app targets on-premises Exchange with OWA forms authentication or integrated Windows
authentication. Exchange Online (Microsoft 365) and sign-in through a separate single sign-on portal
(ADFS or Azure AD) are unsupported.

## Getting and installing a build

Download builds from the project's [latest release](https://github.com/dmitrbrvsk/win-owa-widget/releases/latest).

Choose one of the three application assets; each release also includes `SHA256SUMS.txt`:

1. **Windows x64 installer:** `OWA-Widget-Setup-<version>.exe`. Installs in the user profile without
   administrator privileges. Creates an OWA Widget shortcut in the Start menu, which Windows needs
   for application notifications, and can be removed through **Settings → Apps** in Windows.
2. **Windows ARM64 installer:** `OWA-Widget-Setup-<version>-arm64.exe`. The native ARM64 build;
   installation and removal work the same way. Record ARM64-specific differences separately.
3. **Portable x64 build:** `OWA-Widget-<version>-portable-x64.zip`. Extract it to any folder and run
   `OWA Widget.exe`. It creates no Start menu shortcut, so Windows notifications are not guaranteed.

**Verify the checksum before running a downloaded file.** The installer has no signing certificate,
so SmartScreen may warn about it. In PowerShell, run
`Get-FileHash .\OWA-Widget-Setup-<version>.exe -Algorithm SHA256` and compare the result with that
file's entry in `SHA256SUMS.txt` on the release page. Use the corresponding filename for ARM64 or
portable assets. Only after a match should you choose **More info → Run anyway**. For provenance
verification and its limits, see [SECURITY.en.md](../SECURITY.en.md#how-to-verify-a-downloaded-file).

## Reporting a bug

Include the following in your report:

1. **App version:** shown at the bottom right of the tray window, for example `v1.0.0`.
2. **Build type:** installer or portable archive, together with Windows version and architecture.
3. **Safe support report:** open **Settings → Diagnostics → Copy support report**, review its
   contents, and attach it if useful. It excludes server addresses, credentials, certificates, file
   paths, and meeting contents. The full log at `%APPDATA%\OWA Widget\logs\owa-widget.log`
   (up to 1 MB, with an older `.1` file after rotation) can contain internal server addresses and
   certificate details. Send a log excerpt only after reviewing it and removing internal or other
   sensitive information; do not attach an unreviewed raw log.
4. **Reproduction steps, expected and actual results**, and a screenshot with sensitive data removed.

Report bugs through the [bug report form](https://github.com/dmitrbrvsk/win-owa-widget/issues/new?template=bug_report_en.yml).
Report vulnerabilities through **Security → Report a vulnerability**, **not in public issues**;
see the [security reporting instructions](../SECURITY.en.md#reporting-a-vulnerability).

## Test case structure

Every case has the same fields: **ID**, **Title**, **Preconditions**, **Steps**,
**Expected result**, and **Priority** (high / medium / low). Numbers are local to their area,
for example `НАСТР-03`. The original Cyrillic IDs are retained in this translation.

---

## Contents

1. [Installation and first launch](#1-installation-and-first-launch)
2. [Settings and connection](#2-settings-and-connection)
3. [Tray icon and tooltip](#3-tray-icon-and-tooltip)
4. [Tray window](#4-tray-window)
5. [Meeting details and copying](#5-meeting-details-and-copying)
6. [Invitations and responses](#6-invitations-and-responses)
7. [Searching meetings](#7-searching-meetings)
8. [Reminders](#8-reminders)
9. [Meeting change notifications](#9-meeting-change-notifications)
10. [Creating meetings](#10-creating-meetings)
11. [Finding free time](#11-finding-free-time)
11a. [Meeting statistics](#11a-meeting-statistics)
12. [Themes, language, window size, and working hours](#12-themes-language-window-size-and-working-hours)
13. [Startup and quitting](#13-startup-and-quitting)
14. [Diagnostics](#14-diagnostics)
15. [Updating and uninstalling](#15-updating-and-uninstalling)
16. [Security](#16-security)
17. [Performance and memory](#17-performance-and-memory)
18. [Accessibility and keyboard](#18-accessibility-and-keyboard)
19. [What the developer has not verified](#what-the-developer-has-not-verified)
20. [Groups, privacy, diagnostics, and updates](#groups-privacy-diagnostics-and-updates)
21. [Large calendar window](#large-calendar-window)

---

## 1. Installation and first launch

### УСТ-01 — Verify the installer checksum
- **ID:** УСТ-01
- **Title:** Verify the installer checksum
- **Preconditions:** `OWA-Widget-Setup-<version>.exe` and `SHA256SUMS.txt` have been downloaded from the release page.
- **Steps:**
  1. Open PowerShell in the download folder.
  2. Run `Get-FileHash .\OWA-Widget-Setup-<version>.exe -Algorithm SHA256`.
  3. Compare `Hash` with the entry for this file in `SHA256SUMS.txt`.
- **Expected result:** Values match character for character, ignoring letter case. If they do not match, the file is corrupted or has been replaced; do not install it.
- **Priority:** high

### УСТ-02 — Install the `.exe` without administrator privileges
- **ID:** УСТ-02
- **Title:** Install the `.exe` without administrator privileges
- **Preconditions:** A Windows account without administrator privileges; the app has not been installed before.
- **Steps:**
  1. Run the installer.
  2. In SmartScreen, choose **More info → Run anyway**.
  3. Wait for installation to finish.
- **Expected result:** No administrator permission prompt (UAC) appears. Installation finishes in one step without questions. An **OWA Widget** shortcut appears in the Start menu.
- **Priority:** high

### УСТ-03 — First launch opens settings with a prefilled address
- **ID:** УСТ-03
- **Title:** First launch opens settings with a prefilled address
- **Preconditions:** Installation is complete; the app has never run in this user profile.
- **Steps:**
  1. Launch **OWA Widget** from the Start menu.
  2. Complete or skip the first-run introduction, then inspect the Settings window.
- **Expected result:** After the introduction, Settings opens with `owa.alfabank.ru` already entered in **OWA server address**, and that field has focus. Its hint explains that the OWA address from the browser address bar is required.
- **Priority:** high

### УСТ-04 — Run the portable build from an archive
- **ID:** УСТ-04
- **Title:** Run the portable build from an archive
- **Preconditions:** `OWA-Widget-<version>-portable-x64.zip` has been downloaded; no installed copy is running.
- **Steps:**
  1. Extract the archive to a separate folder, for example on the desktop.
  2. Run `OWA Widget.exe` from that folder.
- **Expected result:** The app starts without installation. Its icon appears in the notification area. On first launch in the profile, the introduction leads to Settings; otherwise, the tray window opens.
- **Priority:** medium

### УСТ-05 — Launch two copies of the same version
- **ID:** УСТ-05
- **Title:** Launch two copies of the same version
- **Preconditions:** The app is already running and its tray icon is visible.
- **Steps:**
  1. Launch the same `OWA Widget.exe` or shortcut a second time.
  2. Check the screen and notification area.
- **Expected result:** No second copy appears. There is still one tray icon; the existing copy simply shows its tray window.
- **Priority:** medium

### УСТ-06 — Launch another version while one is running
- **ID:** УСТ-06
- **Title:** Launch another version while one is running
- **Preconditions:** One version is running, for example from a portable archive, and a different version has been downloaded.
- **Steps:**
  1. Without quitting the first copy, launch the other version.
  2. Wait up to 10 seconds.
- **Expected result:** The old copy exits automatically, the new one starts, and one tray icon remains. If the old copy does not respond, a dialog explains that OWA Widget is already running and how to close it manually.
- **Priority:** medium

### УСТ-07 — Windows 11 hides the tray icon under the ^ arrow
- **ID:** УСТ-07
- **Title:** Windows 11 hides the tray icon under the ^ arrow
- **Preconditions:** Windows 11; the app has just been installed and launched.
- **Steps:**
  1. Check whether the app's icon is visible on the taskbar.
  2. If not, click the **^** arrow to show hidden icons.
  3. Drag the icon onto the visible part of the taskbar.
- **Expected result:** The icon is either directly on the taskbar or under the **^** arrow. Once dragged out, it remains on the taskbar after the app restarts.
- **Priority:** medium

---

### УСТ-08 — Four-step introduction on first launch
- **ID:** УСТ-08
- **Title:** Four-step introduction on first launch
- **Preconditions:** The app has never run for this user; `%APPDATA%\OWA Widget` has been removed.
- **Steps:**
  1. Launch the app.
  2. Read all four steps, advancing with **Next**.
  3. Use **Back** to return one step, then move forward again.
  4. Try the Left and Right arrow keys.
  5. On the final step, click **Go to settings**.
- **Expected result:** The introduction opens at its first step immediately after launch. Buttons, bottom navigation dots, and arrow keys switch steps. The final button is **Go to settings**; it opens Settings and closes the introduction.
- **Priority:** high

### УСТ-09 — Skip the introduction; it does not appear again
- **ID:** УСТ-09
- **Title:** Skip the introduction; it does not appear again
- **Preconditions:** First launch in a clean profile.
- **Steps:**
  1. On the first step, click **Skip**. In separate runs, try the corner close button and Esc.
  2. Finish setting up the server, quit the app, and launch it again.
  3. Launch it once more after restarting the computer.
- **Expected result:** The introduction closes immediately and Settings opens because the server is not configured yet. Subsequent launches do not show the introduction again.
- **Priority:** high

### УСТ-10 — Open the introduction from Settings without interrupting work
- **ID:** УСТ-10
- **Title:** Open the introduction from Settings without interrupting work
- **Preconditions:** The app is configured and the calendar is loaded.
- **Steps:**
  1. Open **Settings → Diagnostics → Show the introduction again**.
  2. Advance to the last step.
  3. Close the window.
- **Expected result:** The introduction opens. Its last button is **Done**, rather than **Go to settings**. Closing it leaves Settings and the tray window working as before; the calendar is not reloaded.
- **Priority:** medium

### УСТ-11 — Updating does not show the introduction again
- **ID:** УСТ-11
- **Title:** Updating does not show the introduction again
- **Preconditions:** An earlier version is installed and configured, and the user profile is retained.
- **Steps:**
  1. Install the new version over the old one.
  2. Launch the app.
- **Expected result:** The introduction does not open. The app immediately uses the existing settings.
- **Priority:** medium

## 2. Settings and connection

### НАСТР-01 — Reject an email address in the server field
- **ID:** НАСТР-01
- **Title:** Reject an email address in the server field
- **Preconditions:** Settings is open.
- **Steps:**
  1. Clear the address and enter `ivanov@company.ru`.
  2. Inspect the hint below the field.
- **Expected result:** The field is marked invalid. A red message explains that this is an email address rather than a server address and asks for the Outlook Web App address from the browser address bar. **Save address** is disabled.
- **Priority:** high

### НАСТР-02 — Sign in with the Windows account and empty credentials
- **ID:** НАСТР-02
- **Title:** Sign in with the Windows account and empty credentials
- **Preconditions:** VPN is connected, a working OWA address is entered, and Login and Password are empty.
- **Steps:**
  1. Click **Test connection**.
  2. Wait for the result.
- **Expected result:** A green success message reports the number of meetings in the coming week, matching OWA in the browser. No password is requested.
- **Priority:** high

### НАСТР-03 — Sign in with a login and password
- **ID:** НАСТР-03
- **Title:** Sign in with a login and password
- **Preconditions:** VPN is connected; a working OWA address and valid credentials, such as `DOMAIN\login`, are known.
- **Steps:**
  1. Enter the login and password.
  2. Click **Test connection**, then **Save**.
  3. Close and reopen Settings.
- **Expected result:** The connection test succeeds. After reopening Settings, a hint says that the password is saved; the password field itself is empty and shows placeholder dots.
- **Priority:** high

### НАСТР-04 — Wrong password: one attempt, then synchronization stops
- **ID:** НАСТР-04
- **Title:** Wrong password: one attempt, then synchronization stops
- **Preconditions:** A working server address, real login, and deliberately **wrong** password. The account is not close to being locked out.
- **Steps:**
  1. Enter the wrong password and save Settings.
  2. Open the tray window and click Refresh several times.
  3. Wait 10–15 minutes, clicking Refresh occasionally.
  4. Inspect the log through **Diagnostics → Open log folder**.
  5. Enter the correct password, save Settings, and approve the native retry confirmation when requested.
- **Expected result:** The footer shows a sign-in error with a button opening Settings. The log records **one** failed attempt: neither automatic synchronization nor Refresh retries it, preventing repeated attempts from locking out the domain account. After the corrected password and native retry approval, the app signs in again and loads meetings.
- **Priority:** high

### НАСТР-05 — Internal or self-signed certificate: native fingerprint confirmation
- **ID:** НАСТР-05
- **Title:** Internal or self-signed certificate: native fingerprint confirmation
- **Preconditions:** An OWA server whose certificate Windows does not trust. Obtain its fingerprint beforehand from IT or the browser.
- **Steps:**
  1. Enter that server's address and click **Test connection**.
  2. Read the error and certificate details below it.
  3. Click **Trust certificate**.
  4. Compare the fingerprint in the Windows dialog and confirm trusting this certificate.
- **Expected result:** The error explains the cause, such as an untrusted issuing authority, and shows the issuer, subject, and expiry date. The native dialog shows the same fingerprint. After confirmation, the calendar loads, and Settings shows the pinned fingerprint and a **Forget** button.
- **Priority:** high

### НАСТР-06 — Changing servers requires native confirmation
- **ID:** НАСТР-06
- **Title:** Changing servers requires native confirmation
- **Preconditions:** A server is configured and working.
- **Steps:**
  1. Replace the server address and click **Save address**.
  2. Read the Windows dialog.
  3. Confirm the connection.
- **Expected result:** The dialog names the new server and warns that it will receive credentials or Windows account authentication data. Cancel is the default. After confirmation, the address changes and the meeting list is cleared and loaded again.
- **Priority:** high

### НАСТР-07 — Cancelling a server change changes nothing
- **ID:** НАСТР-07
- **Title:** Cancelling a server change changes nothing
- **Preconditions:** A server is configured, and a different address has been entered.
- **Steps:**
  1. Click **Save address**.
  2. Cancel in the Windows dialog.
- **Expected result:** A red message explains that the server change was cancelled and the address was not changed. The app continues using the old server, with the existing meetings intact.
- **Priority:** high

### НАСТР-08 — A saved password is not transferred to another server
- **ID:** НАСТР-08
- **Title:** A saved password is not transferred to another server
- **Preconditions:** A password is saved for server A, and meetings load successfully.
- **Steps:**
  1. Change the address to server B and confirm in the Windows dialog.
  2. Inspect the Settings messages and password field.
- **Expected result:** A message says the saved password belonged to the previous server and was removed. The saved-password hint disappears. The password must be entered again.
- **Priority:** high

### НАСТР-09 — An address that does not host OWA
- **ID:** НАСТР-09
- **Title:** An address that does not host OWA
- **Preconditions:** An internal website other than OWA is available, for example a company portal.
- **Steps:**
  1. Enter its address as the server and click **Test connection**.
- **Expected result:** A red message explains that the address has no OWA, for example HTTP 404, or does not look like Outlook Web App, and asks you to check it. The login and password are not sent to that website.
- **Priority:** high

### НАСТР-10 — The server redirects sign-in to a single sign-on portal
- **ID:** НАСТР-10
- **Title:** The server redirects sign-in to a single sign-on portal
- **Preconditions:** A server that redirects sign-in to a separate authentication portal is available.
- **Steps:**
  1. Enter its address and click **Test connection**.
- **Expected result:** The app stops and explains the redirect destination, or that the sign-in page is not an OWA form. It explicitly says the password was not sent.
- **Priority:** high

### НАСТР-11 — VPN is disconnected
- **ID:** НАСТР-11
- **Title:** VPN is disconnected
- **Preconditions:** The server is configured and working, and meetings have loaded.
- **Steps:**
  1. Disconnect the VPN.
  2. Open the tray window and click Refresh.
  3. Inspect the footer and timeline.
  4. Reconnect the VPN and click **Retry** in the footer.
- **Expected result:** The footer shows an offline icon, a network error, and Retry. Already loaded meetings remain visible from the cache; the window does not become blank or freeze. After reconnecting, the footer changes to **Synced just now**.
- **Priority:** high

---

## 3. Tray icon and tooltip

### ТРЕЙ-01 — No imminent meetings: icon without a number
- **ID:** ТРЕЙ-01
- **Title:** No imminent meetings: icon without a number
- **Preconditions:** The next meeting is more than 15 minutes away, or there are no meetings.
- **Steps:**
  1. Inspect the notification area icon.
- **Expected result:** A calendar icon without a number, using colors appropriate to the taskbar: dark on a light taskbar, and vice versa. If there are later meetings, a dot appears on the calendar page.
- **Priority:** medium

### ТРЕЙ-02 — The countdown starts 15 minutes before a meeting
- **ID:** ТРЕЙ-02
- **Title:** The countdown starts 15 minutes before a meeting
- **Preconditions:** An upcoming meeting starts in about 16–17 minutes.
- **Steps:**
  1. Watch the icon until 15 minutes remain.
  2. Keep watching for several more minutes.
- **Expected result:** At exactly 15 minutes, the icon becomes blue and displays minutes remaining. The number decreases automatically, without clicking; the icon refreshes at least every 15 seconds even if the widget window has never been opened.
- **Priority:** high

### ТРЕЙ-03 — Red icon and blinking two minutes before a meeting
- **ID:** ТРЕЙ-03
- **Title:** Red icon and blinking two minutes before a meeting
- **Preconditions:** An upcoming meeting that you **accepted** or organize; Windows animations are enabled.
- **Steps:**
  1. Wait until less than two minutes remain.
  2. Watch the icon.
- **Expected result:** The icon becomes red and blinks, alternating filled and outlined versions about once a second. Blinking lasts no more than 2.5 minutes and stops when the meeting begins.
- **Priority:** medium

### ТРЕЙ-04 — An ongoing meeting has a green icon
- **ID:** ТРЕЙ-04
- **Title:** An ongoing meeting has a green icon
- **Preconditions:** A meeting is in progress.
- **Steps:**
  1. Inspect the icon and compare its number with the actual remaining time.
- **Expected result:** The icon is green and shows minutes until the meeting ends. With an hour or more remaining, it uses an abbreviation such as `1h` in English (`1ч` is the Russian fixture). Digits and the hour suffix remain clear, separate, and within the calendar page on both dark and light taskbars.
- **Priority:** medium

### ТРЕЙ-05 — Unanswered invitations produce a yellow dot
- **ID:** ТРЕЙ-05
- **Title:** Unanswered invitations produce a yellow dot
- **Preconditions:** An invitation from the second mailbox has not been answered.
- **Steps:**
  1. Wait for synchronization, up to five minutes, or click Refresh.
  2. Inspect the icon's top-right corner.
- **Expected result:** A yellow dot is visible in the top-right corner. After you respond to the invitation, it disappears on the next refresh.
- **Priority:** high

### ТРЕЙ-06 — Hover tooltip
- **ID:** ТРЕЙ-06
- **Title:** Hover tooltip
- **Preconditions:** There is an upcoming meeting and at least one unanswered invitation.
- **Steps:**
  1. Hover over the icon and wait for its tooltip.
- **Expected result:** The tooltip names the meeting and the time until it starts. A separate line gives the number of new invitations.
- **Priority:** medium

### ТРЕЙ-07 — Very long meeting title in the tooltip
- **ID:** ТРЕЙ-07
- **Title:** Very long meeting title in the tooltip
- **Preconditions:** Create a meeting with a title of 300+ characters in the second mailbox and accept it. Other invitations remain unanswered.
- **Steps:**
  1. Wait until this becomes the next meeting.
  2. Hover over the icon.
- **Expected result:** The title ends with an ellipsis. The following invitation-count line remains fully visible and is not clipped.
- **Priority:** medium

### ТРЕЙ-08 — Title with hidden characters and right-to-left text
- **ID:** ТРЕЙ-08
- **Title:** Title with hidden characters and right-to-left text
- **Preconditions:** Create a meeting in the second mailbox whose title includes line breaks, control characters, and a Hebrew or Arabic fragment.
- **Steps:**
  1. Wait for the meeting to load and hover over the icon.
  2. Open the tray window and inspect the meeting on the timeline.
- **Expected result:** The tooltip and timeline display the title on **one line**, without control characters. It does not reverse neighboring tooltip lines or overflow its element.
- **Priority:** high

---

## 4. Tray window

### ОКНО-01 — Click the icon to open and close the window
- **ID:** ОКНО-01
- **Title:** Click the icon to open and close the window
- **Preconditions:** The app is running and its window is hidden.
- **Steps:**
  1. Left-click the tray icon.
  2. Click it again.
- **Expected result:** The window appears next to the icon and closes on the second click. The app keeps running.
- **Priority:** medium

### ОКНО-02 — Upcoming meeting and Join button
- **ID:** ОКНО-02
- **Title:** Upcoming meeting and Join button
- **Preconditions:** A meeting with a call link starts today in less than 30 minutes.
- **Steps:**
  1. Open the tray window.
  2. Inspect the card at the top.
- **Expected result:** The next-meeting card shows time until the start, title, time, organizer, and **Join**. Join appears no earlier than 30 minutes before the start and stays available during the meeting. While it is in progress, a progress bar appears at the bottom of the card.
- **Priority:** high

### ОКНО-03 — Day timeline and red now line
- **ID:** ОКНО-03
- **Title:** Day timeline and red now line
- **Preconditions:** Several meetings are scheduled today; the current time is within working hours.
- **Steps:**
  1. Open the tray window and inspect the timeline.
  2. Compare meeting times with OWA.
- **Expected result:** The timeline shows working hours, 08:00–20:00 by default. Meetings appear at the correct times. A horizontal red line marks the current time.
- **Priority:** high

### ОКНО-04 — Overlapping meetings appear side by side
- **ID:** ОКНО-04
- **Title:** Overlapping meetings appear side by side
- **Preconditions:** Two or three meetings overlap on the same day.
- **Steps:**
  1. Open that day in the tray window.
- **Expected result:** Overlapping meetings occupy neighboring columns rather than covering each other. Every title is readable and every meeting can be clicked.
- **Priority:** medium

### ОКНО-05 — All-day meetings
- **ID:** ОКНО-05
- **Title:** All-day meetings
- **Preconditions:** The day contains an all-day event, such as vacation.
- **Steps:**
  1. Open that day in the tray window.
- **Expected result:** All-day events appear in a separate strip above the timeline labeled **All day**, rather than in the hourly grid.
- **Priority:** low

### ОКНО-06 — Multi-day meeting
- **ID:** ОКНО-06
- **Title:** Multi-day meeting
- **Preconditions:** A meeting lasts several days, for example Monday 10:00 through Wednesday 16:00.
- **Steps:**
  1. Inspect each of those days in the tray window.
- **Expected result:** The meeting appears on all three days. On the first it runs from 10:00 to the end of the day, on the second it fills the day, and on the third it ends at 16:00.
- **Priority:** medium

### ОКНО-07 — Meeting spanning midnight
- **ID:** ОКНО-07
- **Title:** Meeting spanning midnight
- **Preconditions:** A meeting is scheduled from 23:30 until 00:30 the following day.
- **Steps:**
  1. Open the first day in the tray window, then the second.
- **Expected result:** The first day's segment ends at midnight; the second runs from midnight to 00:30. Both use the same title and neither segment disappears.
- **Priority:** medium

### ОКНО-08 — Navigate forward and backward through days
- **ID:** ОКНО-08
- **Title:** Navigate forward and backward through days
- **Preconditions:** The tray window is open and neighboring days contain meetings.
- **Steps:**
  1. Click the right arrow several times.
  2. Click the date heading.
  3. Click the left arrow several times.
- **Expected result:** Arrows move one day at a time and the heading shows the correct date. Clicking the heading returns to today. The next-meeting card appears only when viewing today.
- **Priority:** medium

### ОКНО-09 — Second monitor and 150% scaling
- **ID:** ОКНО-09
- **Title:** Second monitor and 150% scaling
- **Preconditions:** A second monitor is connected; one monitor uses 150% scaling.
- **Steps:**
  1. Move the taskbar and icon to the second monitor and open the window.
  2. Return the taskbar to the main monitor with 150% scaling and open it again.
  3. Open Settings, Create meeting, and Find free time.
- **Expected result:** The window always opens on the icon's monitor and fits entirely within its work area. Text and buttons in every window remain readable, without clipping or overlaps.
- **Priority:** high

### ОКНО-10 — Sleep and resume
- **ID:** ОКНО-10
- **Title:** Sleep and resume
- **Preconditions:** The app is running and meetings are loaded.
- **Steps:**
  1. Put the computer to sleep for at least 20 minutes.
  2. Wake it and wait 10–15 seconds.
  3. Open the tray window and inspect the icon.
- **Expected result:** The app refreshes the calendar after resume; the footer shows **Synced just now**. The tray countdown reflects the actual time rather than remaining behind.
- **Priority:** high

---

## 5. Meeting details and copying

### КАРТ-01 — Open meeting details
- **ID:** КАРТ-01
- **Title:** Open meeting details
- **Preconditions:** A meeting with attendees and a description is visible in the tray window.
- **Steps:**
  1. Click the meeting on the timeline.
- **Expected result:** A details card opens above the window. It shows date and time, duration, organizer, location, required and optional attendees with colored response indicators, and the complete meeting description.
- **Priority:** medium

### КАРТ-02 — Links in the meeting description
- **ID:** КАРТ-02
- **Title:** Links in the meeting description
- **Preconditions:** A meeting details card is open and its description contains a link.
- **Steps:**
  1. Hover over the description link.
  2. Click it.
- **Expected result:** The tooltip shows the link's actual hostname. Clicking opens it in the default browser, not within the app.
- **Priority:** high

### КАРТ-03 — Copy from meeting details
- **ID:** КАРТ-03
- **Title:** Copy from meeting details
- **Preconditions:** A meeting details card with a call link is open.
- **Steps:**
  1. Click **Copy link**.
  2. Paste the clipboard into Notepad.
  3. Click **Copy title, time and link**, then paste again.
- **Expected result:** The first copy contains only the URL. The second has the form `Title — 7 Oct, 15:00–16:00 — https://…`. Both operations show **Copied** in the window.
- **Priority:** medium

### КАРТ-04 — Right-click copy menu
- **ID:** КАРТ-04
- **Title:** Right-click copy menu
- **Preconditions:** A meeting with a link is on the timeline.
- **Steps:**
  1. Right-click the meeting.
  2. Choose **Copy title**.
  3. Repeat and choose **Copy title, time and link**.
- **Expected result:** A native Windows menu offers **Copy title**, **Copy link**, and **Copy title, time and link**. The widget window stays visible while the menu is open. The clipboard contains exactly the selected text.
- **Priority:** medium

### КАРТ-05 — Copy a title containing line breaks
- **ID:** КАРТ-05
- **Title:** Copy a title containing line breaks
- **Preconditions:** A meeting title contains a line break or tab.
- **Steps:**
  1. Copy its title from the right-click menu.
  2. Paste it into a chat field or Notepad.
- **Expected result:** The clipboard contains one line without line breaks. Pasting does not create several separate chat messages.
- **Priority:** medium

---

## 6. Invitations and responses

### ПРИГЛ-01 — New invitations are grouped at the top
- **ID:** ПРИГЛ-01
- **Title:** New invitations are grouped at the top
- **Preconditions:** Two invitations have arrived from the second mailbox and remain unanswered.
- **Steps:**
  1. Wait for synchronization and open the tray window.
  2. Click **New invitations**.
- **Expected result:** A **New invitations** section with a counter appears above the timeline. Clicking expands a list of invitations with dates, times, and titles.
- **Priority:** medium

### ПРИГЛ-02 — Accept an invitation
- **ID:** ПРИГЛ-02
- **Title:** Accept an invitation
- **Preconditions:** The details of an unanswered invitation are open.
- **Steps:**
  1. Click **Accept**.
  2. Check the second mailbox, belonging to the organizer.
- **Expected result:** A message confirms that the response was sent. Accept has a checkmark. The organizer receives an accepted response, and OWA shows the same status.
- **Priority:** high

### ПРИГЛ-03 — Tentative and Decline responses
- **ID:** ПРИГЛ-03
- **Title:** Tentative and Decline responses
- **Preconditions:** There are two new invitations.
- **Steps:**
  1. Click **Tentative** on the first and **Decline** on the second.
  2. Check both in OWA and in the organizer's mailbox.
- **Expected result:** The organizer receives the corresponding responses. The declined meeting is no longer included in the tray countdown or reminders.
- **Priority:** high

### ПРИГЛ-04 — Answered invitations leave the new-invitations section
- **ID:** ПРИГЛ-04
- **Title:** Answered invitations leave the new-invitations section
- **Preconditions:** ПРИГЛ-02 is complete.
- **Steps:**
  1. Wait for the next synchronization, up to five minutes, or click Refresh.
  2. Inspect **New invitations** and the tray icon.
- **Expected result:** The counter decreases and the answered invitation disappears. When no unanswered invitations remain, the yellow tray dot disappears.
- **Priority:** medium

### ПРИГЛ-05 — Invitation linking to an unfamiliar website
- **ID:** ПРИГЛ-05
- **Title:** Invitation linking to an unfamiliar website
- **Preconditions:** The second mailbox sent an invitation whose description links to a website outside Teams, Zoom, Webex, Google Meet, and KTalk, for example `https://example.org/room/1`.
- **Steps:**
  1. Open its details and inspect Join and the description link.
  2. Right-click the timeline meeting and inspect the tray icon's menu.
- **Expected result:** The actual hostname, such as `example.org`, appears beside Join in details, the next-meeting card, and the tray menu. Hover tooltips show the same hostname. No button opens the link without displaying its destination.
- **Priority:** high

### ПРИГЛ-06 — Meeting title impersonating a button
- **ID:** ПРИГЛ-06
- **Title:** Meeting title impersonating a button
- **Preconditions:** The second mailbox sent an invitation with a title such as the fixture `Подключиться  ✓ Принять  — нажмите здесь` or its English equivalent, `Join  ✓ Accept  — click here`.
- **Steps:**
  1. Open the tray window and that meeting's details.
  2. Try clicking the apparent button within the title.
- **Expected result:** The title remains ordinary text. Clicking it opens meeting details and sends nothing to the server. Actual response buttons are visually distinct from title text.
- **Priority:** high

### ПРИГЛ-07 — Warn about overlapping meetings
- **ID:** ПРИГЛ-07
- **Title:** Warn about overlapping meetings
- **Preconditions:** An accepted meeting runs 11:00–12:00; the second mailbox sent an invitation for 11:30–12:30.
- **Steps:**
  1. Find the invitation under **New invitations** in the tray window.
  2. Open its details.
  3. Click **Decline** beside the overlapping meeting, then confirm with the second click.
- **Expected result:** The invitation list marks the overlap. A yellow **Overlaps one of your meetings** block above the responses names the other meeting and its time. Decline requires a second click before sending a decline for that other meeting; if you organize it, there is no Decline button. Accepted meetings without overlaps show no warning block.
- **Priority:** medium

### ПРИГЛ-08 — Reply with a comment
- **ID:** ПРИГЛ-08
- **Title:** Reply with a comment
- **Preconditions:** The details of an unanswered invitation are open.
- **Steps:**
  1. Click **Reply with a comment**, select **Tentative**, and enter text.
  2. Click **Send**, then cancel in the native Windows dialog.
  3. Repeat and confirm sending.
  4. Check the organizer's mailbox.
- **Expected result:** The native dialog shows the meeting, response, and comment. Cancel is the default and the Esc action; cancellation sends nothing. After confirmation, the organizer receives the response with your text and the widget shows a confirmation. Empty comments cannot be sent; the counter enforces a 1000-character limit.
- **Priority:** high

### ПРИГЛ-09 — Propose another time
- **ID:** ПРИГЛ-09
- **Title:** Propose another time
- **Preconditions:** Another person's invitation is open in details.
- **Steps:**
  1. Click **Propose another time** and choose a new date and time.
  2. Try a past time, then an end before the start, then a valid interval.
  3. Add a comment and send, confirming in the native dialog.
- **Expected result:** Past times and reversed intervals show clear errors and cannot be sent. Meetings overlapping the proposed time are displayed. The organizer receives a response email, tentative or declined, with text describing the proposed time. Their calendar is not moved automatically: this is a message, not an Outlook counterproposal.
- **Priority:** high

### ПРИГЛ-10 — Personal meeting note
- **ID:** ПРИГЛ-10
- **Title:** Personal meeting note
- **Preconditions:** Any meeting details card is open.
- **Steps:**
  1. Type into **My note** and wait one second for **Saved**.
  2. Close the window and reopen the same meeting.
  3. Inspect the timeline.
  4. Check the organizer's mailbox and network traffic.
- **Expected result:** The saved note returns and the meeting has a pencil marker on the timeline. It is never sent to Exchange or any other address; the organizer and attendees cannot see it. It is stored in an encrypted profile file. If Windows encryption is unavailable, the app reports that the note was not saved.
- **Priority:** medium

### ПРИГЛ-11 — Delete all notes
- **ID:** ПРИГЛ-11
- **Title:** Delete all notes
- **Preconditions:** At least one note exists, as in ПРИГЛ-10.
- **Steps:**
  1. Open **Settings → Meeting notes → Delete all notes**.
  2. Cancel in the native dialog, then repeat and confirm deletion.
- **Expected result:** Cancelling retains the notes. Confirmation removes all notes and timeline markers and displays a deletion message. Notes for meetings older than approximately three months are deleted automatically.
- **Priority:** medium

---

## 7. Searching meetings

### ПОИСК-01 — Open search with Ctrl+F and /
- **ID:** ПОИСК-01
- **Title:** Open search with Ctrl+F and /
- **Preconditions:** The tray window is open and meeting details are closed.
- **Steps:**
  1. Press Ctrl+F.
  2. Press Esc, then the **/** key.
  3. Switch to the Russian keyboard layout and press Ctrl+F again.
- **Expected result:** Each of the three actions replaces the heading with a focused search field. Esc closes search and clears the query.
- **Priority:** medium

### ПОИСК-02 — Search titles, organizers, and locations
- **ID:** ПОИСК-02
- **Title:** Search titles, organizers, and locations
- **Preconditions:** The calendar contains meetings with different titles, organizers, and locations.
- **Steps:**
  1. Open search and enter a word from a meeting title.
  2. Clear the field and enter an organizer's surname.
  3. Clear it and enter a meeting room name.
- **Expected result:** Matching meetings appear in each case. Title matches rank above organizer, location, and description matches.
- **Priority:** medium

### ПОИСК-03 — Treat U+0451 and U+0435 as equivalent
- **ID:** ПОИСК-03
- **Title:** Treat U+0451 and U+0435 as equivalent
- **Preconditions:** A meeting has the fixture title `Планерка`, with its U+0435 character replaced by U+0451. Enter the actual Unicode character, not a literal escape sequence.
- **Steps:**
  1. Search for the fixture `планерка`, using U+0435.
  2. Clear the field and enter uppercase `ПЛАНЕРКА`, replacing U+0415 with U+0401.
- **Expected result:** Both queries find the meeting. Letter case also makes no difference.
- **Priority:** medium

### ПОИСК-04 — Queries are neither sent to the server nor logged
- **ID:** ПОИСК-04
- **Title:** Queries are neither sent to the server nor logged
- **Preconditions:** The app is connected to the server and the log is open.
- **Steps:**
  1. Note the log file's size and last entries.
  2. Run five or six different searches.
  3. Reopen the log.
- **Expected result:** There are no log entries containing query text and no new network requests caused by searching.
- **Priority:** high

### ПОИСК-05 — Choose a result with the keyboard
- **ID:** ПОИСК-05
- **Title:** Choose a result with the keyboard
- **Preconditions:** Search is open and several meetings were found.
- **Steps:**
  1. Press Down several times, then Up.
  2. Press Enter on the highlighted result.
- **Expected result:** Highlighting moves through the list and wraps from the last entry to the first. Enter opens the chosen meeting's details and switches the timeline to its day.
- **Priority:** medium

### ПОИСК-06 — Special characters do not freeze search
- **ID:** ПОИСК-06
- **Title:** Special characters do not freeze search
- **Preconditions:** Search is open.
- **Steps:**
  1. Enter `(((((((((`, then `.*.*.*.*`, then a string of 150 copies of Cyrillic `а` (U+0430).
- **Expected result:** The window responds immediately without freezing. The long query is limited to 100 characters; the field accepts no more. Results are either empty or correct.
- **Priority:** medium

---

## 8. Reminders

### НАПОМ-01 — Windows notification reminder from the installed build
- **ID:** НАПОМ-01
- **Title:** Windows notification reminder from the installed build
- **Preconditions:** The **installed** build is running. **How to show the reminder** is **Automatic**, the reminder is set to one minute before the meeting (the default), and Windows Do not disturb is off.
- **Steps:**
  1. Create a meeting starting in three minutes.
  2. Wait until one minute remains.
- **Expected result:** A Windows notification appears with **Meeting in 1 min**, the title, time, organizer, a dropdown offering **Snooze for 5 / 10 / 15 min**, and action buttons. It stays until acted upon rather than disappearing automatically.
- **Priority:** high

### НАПОМ-02 — Join from a notification
- **ID:** НАПОМ-02
- **Title:** Join from a notification
- **Preconditions:** НАПОМ-01 is complete and the meeting has a link to a recognized service.
- **Steps:**
  1. Click **Join** in the notification.
- **Expected result:** The default browser opens the correct URL. The app window does not open.
- **Priority:** high

### НАПОМ-03 — Select a snooze interval
- **ID:** НАПОМ-03
- **Title:** Select a snooze interval
- **Preconditions:** A reminder notification is displayed for a meeting starting more than 15 minutes later.
- **Steps:**
  1. Select **Snooze for 10 min** in the dropdown.
  2. Click **Snooze**.
  3. Measure the elapsed time.
- **Expected result:** The notification disappears and returns in approximately 10 minutes, no later than the meeting start. Leaving the dropdown untouched snoozes for five minutes.
- **Priority:** high

### НАПОМ-04 — Portable build uses its own reminder window
- **ID:** НАПОМ-04
- **Title:** Portable build uses its own reminder window
- **Preconditions:** The **portable** build is running and **How to show the reminder** is **Automatic**.
- **Steps:**
  1. Create a meeting starting in three minutes and wait for the reminder.
- **Expected result:** Instead of a Windows notification, an app window appears at the bottom right above the taskbar. It shows title, time, **Join** when there is a link, a snooze action, and a close button.
- **Priority:** high

### НАПОМ-05 — Explicitly select App window
- **ID:** НАПОМ-05
- **Title:** Explicitly select App window
- **Preconditions:** The installed build is running with **App window** selected in Settings.
- **Steps:**
  1. Wait for the next meeting reminder.
- **Expected result:** The app's own window appears and there is no Windows notification, even though the installed build supports them.
- **Priority:** high

### НАПОМ-06 — Windows Do not disturb
- **ID:** НАПОМ-06
- **Title:** Windows Do not disturb
- **Preconditions:** The installed build is running; **How to show the reminder** is **Windows notification**. Windows Do not disturb or Focus assist is enabled.
- **Steps:**
  1. Wait for the reminder time.
  2. Open Windows Notification Center.
- **Expected result:** The notification does not pop up over the screen but is present in Notification Center; this is Windows behavior. Selecting **App window** restores a visible reminder.
- **Priority:** high

### НАПОМ-07 — Meetings starting close together
- **ID:** НАПОМ-07
- **Title:** Meetings starting close together
- **Preconditions:** Two meetings start within 10 minutes of each other, for example at 15:00 and 15:07.
- **Steps:**
  1. Wait for the first meeting's reminder.
- **Expected result:** **One** reminder lists both meetings. Its **Open** button replaces Join and opens the widget window.
- **Priority:** medium

### НАПОМ-08 — Reminder for a meeting with an unfamiliar link
- **ID:** НАПОМ-08
- **Title:** Reminder for a meeting with an unfamiliar link
- **Preconditions:** A meeting links to a website outside the list of recognized services.
- **Steps:**
  1. Wait for its reminder and inspect the join action.
- **Expected result:** The action shows the actual hostname beside Join, for example **Join · example.org**.
- **Priority:** high

---

## 9. Meeting change notifications

### ИЗМ-01 — New invitation
- **ID:** ИЗМ-01
- **Title:** New invitation
- **Preconditions:** The app has completed at least one synchronization cycle; **Notify about meeting changes** is enabled in Settings.
- **Steps:**
  1. Send a meeting invitation from the second mailbox.
  2. Wait for synchronization, up to five minutes, or click Refresh.
- **Expected result:** A **New invitation** notification shows who invited you, the title, time, and an **Accept** button.
- **Priority:** high

### ИЗМ-02 — Accept directly from a notification
- **ID:** ИЗМ-02
- **Title:** Accept directly from a notification
- **Preconditions:** The notification from ИЗМ-01 is displayed.
- **Steps:**
  1. Click **Accept**.
  2. Check the second mailbox.
- **Expected result:** A brief **Invitation accepted** notification appears and the organizer receives the response. On failure, **Could not accept the invitation** appears; clicking it opens the meeting in the app.
- **Priority:** high

### ИЗМ-03 — Meeting rescheduled
- **ID:** ИЗМ-03
- **Title:** Meeting rescheduled
- **Preconditions:** A meeting is already loaded in the widget.
- **Steps:**
  1. From the second mailbox, acting as organizer, move it to another time.
  2. Wait for synchronization.
- **Expected result:** **Meeting rescheduled** shows the title, new time, and previous time with a **was…** indication. Clicking the text opens that meeting's details in the widget.
- **Priority:** medium

### ИЗМ-04 — Meeting cancelled
- **ID:** ИЗМ-04
- **Title:** Meeting cancelled
- **Preconditions:** A meeting is loaded.
- **Steps:**
  1. Cancel it as the organizer.
  2. Wait for synchronization.
- **Expected result:** **Meeting cancelled** shows its title and former time. The meeting is crossed out in the window.
- **Priority:** medium

### ИЗМ-05 — Bulk changes produce one summary notification
- **ID:** ИЗМ-05
- **Title:** Bulk changes produce one summary notification
- **Preconditions:** The calendar contains a recurring series with at least five occurrences.
- **Steps:**
  1. Reschedule the entire series as the organizer.
  2. Wait for synchronization.
- **Expected result:** One **Calendar changes** notification appears instead of a flood, with counters such as **rescheduled: 7**. Individual notifications appear only when there are no more than three changes.
- **Priority:** high

### ИЗМ-06 — No more than six change notifications per hour
- **ID:** ИЗМ-06
- **Title:** No more than six change notifications per hour
- **Preconditions:** You can change many meetings individually in quick succession.
- **Steps:**
  1. Within one hour, change 8–10 different meetings one at a time, ensuring each change is picked up by a separate synchronization.
  2. Count the notifications.
- **Expected result:** At most six change notifications appear in an hour. Other changes are reflected in the window without notifications.
- **Priority:** medium

---

## 10. Creating meetings

### СОЗД-01 — Open the meeting creation window
- **ID:** СОЗД-01
- **Title:** Open the meeting creation window
- **Preconditions:** The app is connected to the server.
- **Steps:**
  1. Open the tray window and click **+**.
  2. Close the new window, then reopen it through **Create meeting…** in the tray menu.
- **Expected result:** Both actions open the Create meeting window with subject, date, start and end times, quick duration choices, required and optional attendees, location, and description. The subject field has focus.
- **Priority:** medium

### СОЗД-02 — Directory suggestions for attendees
- **ID:** СОЗД-02
- **Title:** Directory suggestions for attendees
- **Preconditions:** The server connection works and Create meeting is open.
- **Steps:**
  1. Start typing a colleague's surname, at least two letters, into **Required**.
  2. Wait approximately one second.
  3. Choose a person with the arrow keys and Enter.
- **Expected result:** A list of at most eight names and addresses appears below the field. The chosen address becomes a chip; hovering over it shows the person's name.
- **Priority:** medium

### СОЗД-03 — Reject email addresses containing Cyrillic lookalikes
- **ID:** СОЗД-03
- **Title:** Reject email addresses containing Cyrillic lookalikes
- **Preconditions:** Create meeting is open.
- **Steps:**
  1. In **Required**, enter an address with Latin `a`, `o`, `e`, or `c` replaced by visually similar Cyrillic characters, for example the fixture `ivаn@cоmpany.ru`, and press Enter.
- **Expected result:** The address does not become a chip. A red validation message identifies the rejected address. A meeting cannot be sent with that address.
- **Priority:** high

### СОЗД-04 — Saving a meeting without attendees requires native confirmation
- **ID:** СОЗД-04
- **Title:** Saving a meeting without attendees requires native confirmation
- **Preconditions:** Create meeting is open and attendee fields are empty.
- **Steps:**
  1. Enter a subject and time, then click **Save to calendar**.
  2. Check the subject, time, and location in the native dialog. Cancel: no entry is created.
  3. Save again and confirm saving in the native dialog. Check OWA.
- **Expected result:** No entry exists before native confirmation. After confirmation, the meeting appears in your calendar. The window shows **Meeting created** and closes automatically after approximately two seconds.
- **Priority:** high

### СОЗД-05 — Native confirmation before invitations are sent
- **ID:** СОЗД-05
- **Title:** Native confirmation before invitations are sent
- **Preconditions:** Subject, time, location, and description are filled in; two or three attendees have been added.
- **Steps:**
  1. Click **Send invitation**.
  2. Carefully read the Windows dialog.
- **Expected result:** It states the recipient count and shows subject, date and time, location, the beginning of the description, and recipients with optional attendees marked. It offers cancellation and sending; cancellation is selected by default.
- **Priority:** high

### СОЗД-06 — Cancel in the confirmation dialog
- **ID:** СОЗД-06
- **Title:** Cancel in the confirmation dialog
- **Preconditions:** The confirmation dialog from СОЗД-05 is displayed.
- **Steps:**
  1. Press Esc or cancel.
  2. Check your calendar and Sent Items in OWA.
- **Expected result:** Create meeting returns to editing with a cancellation note, retaining all fields. Neither a meeting nor invitations were created on the server.
- **Priority:** high

### СОЗД-07 — Send invitations successfully
- **ID:** СОЗД-07
- **Title:** Send invitations successfully
- **Preconditions:** The confirmation dialog is displayed; the second test mailbox is a recipient.
- **Steps:**
  1. Confirm sending.
  2. Check the second mailbox and your OWA calendar.
  3. Inspect the log.
- **Expected result:** The window shows **Meeting created** with the number invited, then closes automatically. The second mailbox receives an invitation with the correct subject, time, location, and description. A log entry such as `createMeeting: created, 3 invited` contains neither the subject nor addresses.
- **Priority:** high

### СОЗД-08 — More than 15 recipients in the confirmation dialog
- **ID:** СОЗД-08
- **Title:** More than 15 recipients in the confirmation dialog
- **Preconditions:** Twenty valid addresses have been added under **Required**.
- **Steps:**
  1. Send and read the confirmation dialog.
- **Expected result:** It lists the first 15 addresses and indicates five more below. The heading states the total recipient count, 20.
- **Priority:** medium

### СОЗД-09 — Reject more than 100 attendees
- **ID:** СОЗД-09
- **Title:** Reject more than 100 attendees
- **Preconditions:** A list of 110 valid addresses is ready.
- **Steps:**
  1. Paste the list into **Required**.
- **Expected result:** No more than 100 addresses are added. A message explains the 100-recipient limit. No confirmation dialog appears and nothing is sent to the server.
- **Priority:** high

### СОЗД-10 — Hourly meeting limit
- **ID:** СОЗД-10
- **Title:** Hourly meeting limit
- **Preconditions:** You can create many meetings in succession.
- **Steps:**
  1. Create 10 meetings in succession, with or without attendees.
  2. Try to create an eleventh.
- **Expected result:** The eleventh is rejected with a message explaining the limit of 10 meetings per hour and asking you to wait. No server request is sent.
- **Priority:** medium

### СОЗД-11 — Click Send twice
- **ID:** СОЗД-11
- **Title:** Click Send twice
- **Preconditions:** A meeting with attendees is filled in.
- **Steps:**
  1. Quickly double-click the send button.
- **Expected result:** The confirmation dialog appears once. The second click either does nothing or reports that the previous meeting is still being sent. The second mailbox receives **one** invitation.
- **Priority:** high

### СОЗД-12 — Empty subject
- **ID:** СОЗД-12
- **Title:** Empty subject
- **Preconditions:** Create meeting is open and the subject is empty.
- **Steps:**
  1. Click Save to calendar or Send invitation.
- **Expected result:** The subject is marked invalid, a message explains that it is required, and focus returns to that field. There is neither a confirmation dialog nor a server request.
- **Priority:** high

### СОЗД-13 — Connection drops while sending
- **ID:** СОЗД-13
- **Title:** Connection drops while sending
- **Preconditions:** A meeting with attendees is ready to send.
- **Steps:**
  1. Confirm sending in the dialog.
  2. Immediately disconnect VPN without waiting for the response.
  3. Read the message, reconnect VPN, and check your OWA calendar and Sent Items.
- **Expected result:** The app reports a network error and does **not** retry automatically. Its message asks you to check the calendar first. The second mailbox must not receive two identical invitations.
- **Priority:** high

### СОЗД-14 — Subject containing markup and control characters
- **ID:** СОЗД-14
- **Title:** Subject containing markup and control characters
- **Preconditions:** Create meeting is open.
- **Steps:**
  1. Enter the fixture subject `Отчет </Subject><Evil/> & "итоги" <b>жирный</b>`.
  2. Create the meeting without attendees and open it in OWA.
- **Expected result:** OWA shows the entered subject **character for character** as ordinary text. No markup is created and the meeting is saved without errors.
- **Priority:** high

---

### СОЗД-15 — Recurrence count is shown in confirmation
- **ID:** СОЗД-15
- **Title:** Recurrence count is shown in confirmation
- **Preconditions:** The app is connected and you have the second mailbox's address.
- **Steps:**
  1. Open **Create meeting**; enter a subject, time, and one attendee.
  2. Under **Repeat**, select **Every week on <weekday>**. Under **Ends**, select **times** and enter 5.
  3. Click **Send invitation** and read the confirmation.
  4. Confirm sending and open the OWA calendar.
- **Expected result:** Confirmation describes a weekly recurrence on the selected weekday with five occurrences. After sending, the calendar contains five weekly meetings and the attendee receives a series invitation.
- **Priority:** high

### СОЗД-16 — Recurrence is limited to 100 occurrences and two years
- **ID:** СОЗД-16
- **Title:** Recurrence is limited to 100 occurrences and two years
- **Preconditions:** Create meeting is open.
- **Steps:**
  1. Choose **Every day**, end after a number of **times**, and try entering 500.
  2. Switch **Ends** to **on a date** and choose a date more than two years away.
  3. Choose an end date before the meeting's start date.
- **Expected result:** The field accepts no more than 100 occurrences. Dates more than two years away or before the first meeting are rejected with clear messages. Nothing is sent.
- **Priority:** medium

### СОЗД-17 — Every weekday excludes weekends
- **ID:** СОЗД-17
- **Title:** Every weekday excludes weekends
- **Preconditions:** The app is connected.
- **Steps:**
  1. Create a Friday meeting with **Every weekday**, five occurrences, and no attendees.
  2. Inspect the following week's calendar.
- **Expected result:** Occurrences fall on weekdays, Monday through Friday, with none on Saturday or Sunday.
- **Priority:** medium

### СОЗД-18 — Change the time of a meeting you organize
- **ID:** СОЗД-18
- **Title:** Change the time of a meeting you organize
- **Preconditions:** You organize a meeting with one or two attendees.
- **Steps:**
  1. Open its details from the tray window.
  2. Click **Change** to open a form prefilled with its data.
  3. Move it one hour later and click **Save and tell the attendees**.
  4. Read and approve confirmation, then check your calendar and an attendee's mail.
- **Expected result:** Subject, time, location, description, and attendees are prefilled. Confirmation shows old and new times. After approval, the meeting is moved and the attendee receives an update.
- **Priority:** high

### СОЗД-19 — Change the attendee list
- **ID:** СОЗД-19
- **Title:** Change the attendee list
- **Preconditions:** You organize a meeting with one attendee and have another attendee's address.
- **Steps:**
  1. Click **Change**, add the second attendee, and remove the first.
  2. Read and approve confirmation.
- **Expected result:** Confirmation lists added and removed attendees separately. After sending, the added attendee receives an invitation, and the removed attendee receives notice that they are no longer invited.
- **Priority:** high

### СОЗД-20 — Reject an edit with no changes
- **ID:** СОЗД-20
- **Title:** Reject an edit with no changes
- **Preconditions:** You organize a meeting.
- **Steps:**
  1. Click **Change**, modify nothing, and click the save action.
- **Expected result:** The app reports **Nothing in the meeting has changed**. No confirmation appears, nothing is sent to the server, and attendees receive nothing.
- **Priority:** medium

### СОЗД-21 — Cancel your meeting and notify attendees
- **ID:** СОЗД-21
- **Title:** Cancel your meeting and notify attendees
- **Preconditions:** You organize a meeting with an attendee.
- **Steps:**
  1. Open details and click **Cancel the meeting**.
  2. Read confirmation and first choose to keep the meeting.
  3. Repeat and confirm cancellation.
  4. Check your calendar and the attendee's mail.
- **Expected result:** The dialog names the meeting and time, states how many people will be notified, and explains that cancellation cannot be undone. Keeping the meeting is the default and the Esc action. After confirmation, it disappears from your calendar and the attendee receives a cancellation notice.
- **Priority:** high

### СОЗД-22 — You cannot edit or cancel someone else's or a cancelled meeting
- **ID:** СОЗД-22
- **Title:** You cannot edit or cancel someone else's or a cancelled meeting
- **Preconditions:** The calendar contains a meeting organized by someone else and a meeting already cancelled.
- **Steps:**
  1. Open the other person's meeting.
  2. Open the cancelled meeting.
- **Expected result:** Neither card offers **Change** or **Cancel the meeting**.
- **Priority:** medium

### СОЗД-23 — Edit a meeting in a series
- **ID:** СОЗД-23
- **Title:** Edit a meeting in a series
- **Preconditions:** You organize a recurring meeting.
- **Steps:**
  1. Open any occurrence's details and click **Change**.
- **Expected result:** The form explains that changes apply to the whole series. Recurrence selection is unavailable while editing.
- **Priority:** medium

## 11. Finding free time

### СВОБ-01 — Open Find free time
- **ID:** СВОБ-01
- **Title:** Open Find free time
- **Preconditions:** The app is connected to the server.
- **Steps:**
  1. Click the calendar button in the tray window.
  2. Close the window, then reopen it from **Find free time…** in the tray menu.
- **Expected result:** Both actions open Find free time with an attendee field, 30 / 45 / 60 / 90-minute duration choices, a weekly availability grid, and **Best options** on the right.
- **Priority:** medium

### СВОБ-02 — Availability grid by attendee
- **ID:** СВОБ-02
- **Title:** Availability grid by attendee
- **Preconditions:** The window is open; two or three colleagues have populated calendars.
- **Steps:**
  1. Add their addresses to Attendees.
  2. Wait for loading and compare availability with their OWA calendars.
- **Expected result:** Each attendee has a row. Grid intervals are 30 minutes and only configured working hours appear. Colors match actual status: **Free**, **Tentative**, **Busy**, **Out of office**, or **No data**.
- **Priority:** high

### СВОБ-03 — No data for an inaccessible calendar
- **ID:** СВОБ-03
- **Title:** No data for an inaccessible calendar
- **Preconditions:** You know an address whose calendar is inaccessible to you, or a nonexistent address in the company domain.
- **Steps:**
  1. Add it to Attendees.
- **Expected result:** Its row is gray, indicating **No data**, with a warning icon by the name. Other attendees display normally; the entire window does not fail.
- **Priority:** high

### СВОБ-04 — Best options
- **ID:** СВОБ-04
- **Title:** Best options
- **Preconditions:** Two or three attendees with partly busy calendars have been added; duration is 60 minutes.
- **Steps:**
  1. Inspect the list on the right.
  2. Compare proposed intervals with the grid.
- **Expected result:** At most five options are offered, none with anyone Busy or Out of office, and at most two per day. Past times are excluded. Each option explains whether everyone is free or which attendees are tentative or have no data.
- **Priority:** high

### СВОБ-05 — Highlight the selected option in the grid
- **ID:** СВОБ-05
- **Title:** Highlight the selected option in the grid
- **Preconditions:** The list contains at least one option.
- **Steps:**
  1. Click an option on the right.
- **Expected result:** A vertical band highlights its grid columns; the grid scrolls to them if necessary. **Create a meeting at this time** becomes enabled.
- **Priority:** medium

### СВОБ-06 — Create a meeting from the selected time
- **ID:** СВОБ-06
- **Title:** Create a meeting from the selected time
- **Preconditions:** An option is selected and Attendees contains two addresses.
- **Steps:**
  1. Click **Create a meeting at this time**.
  2. Inspect the meeting creation form.
- **Expected result:** Date, start and end times exactly match the option. Both attendees are prefilled under **Required**. The subject is empty.
- **Priority:** high

### СВОБ-07 — Navigate weeks and return to This week
- **ID:** СВОБ-07
- **Title:** Navigate weeks and return to This week
- **Preconditions:** The window is open and attendees have been added.
- **Steps:**
  1. Click the right arrow twice, then the left arrow three times.
  2. Click **This week**.
- **Expected result:** The week label and grid change, and availability is fetched again. This week is disabled when the current week is already selected.
- **Priority:** medium

### СВОБ-08 — Reject more than 20 attendees
- **ID:** СВОБ-08
- **Title:** Reject more than 20 attendees
- **Preconditions:** A list of 25 valid addresses is ready.
- **Steps:**
  1. Paste it into Attendees.
- **Expected result:** At most 20 addresses are added, with a message explaining the limit. No request containing excess addresses is sent to the server.
- **Priority:** high

### СВОБ-09 — No suitable time
- **ID:** СВОБ-09
- **Title:** No suitable time
- **Preconditions:** Attendees are busy all week; duration is 90 minutes.
- **Steps:**
  1. Inspect the right-hand panel.
- **Expected result:** It says **No suitable time this week** and suggests another week, a shorter meeting, or fewer attendees. The create-meeting button is disabled.
- **Priority:** medium

### СВОБ-10 — Availability request fails
- **ID:** СВОБ-10
- **Title:** Availability request fails
- **Preconditions:** The window is open with attendees.
- **Steps:**
  1. Disconnect VPN and click the window's refresh button.
- **Expected result:** A prominent error and **Retry** appear at the top so it is clear that the grid below no longer reflects current availability.
- **Priority:** high

---

## 11a. Meeting statistics

### СТАТ-01 — Open statistics and choose a period
- **ID:** СТАТ-01
- **Title:** Open statistics and choose a period
- **Preconditions:** The app is connected and the calendar contains meetings from recent weeks.
- **Steps:**
  1. Click the chart button in the tray window, or **Meeting statistics…** in the tray menu.
  2. Switch between **This week**, **Last week**, and **Last 4 weeks**.
  3. Compare the weekly meeting count with OWA.
- **Expected result:** The window opens and shows period dates beside the selector. Values recalculate when the period changes and match the calendar.
- **Priority:** high

### СТАТ-02 — Exclude cancelled and declined meetings
- **ID:** СТАТ-02
- **Title:** Exclude cancelled and declined meetings
- **Preconditions:** The period contains a meeting cancelled by its organizer and a meeting you declined.
- **Steps:**
  1. Open statistics for that period and inspect **Total in meetings** and **Meetings**.
- **Expected result:** Neither cancelled nor declined meetings contribute hours or meeting counts.
- **Priority:** high

### СТАТ-03 — All-day and overnight meetings
- **ID:** СТАТ-03
- **Title:** All-day and overnight meetings
- **Preconditions:** The period contains an all-day event and a meeting spanning midnight.
- **Steps:**
  1. Inspect **All-day days**, **Total in meetings**, and the per-day bars.
- **Expected result:** The all-day event counts as days and adds no hours. The overnight meeting is split across its two days according to actual time spent on each.
- **Priority:** medium

### СТАТ-04 — Most often with and an empty period
- **ID:** СТАТ-04
- **Title:** Most often with and an empty period
- **Preconditions:** One week contains meetings and another is empty, for example during vacation.
- **Steps:**
  1. Inspect **Most often with** for the populated week.
  2. Switch to the empty week.
- **Expected result:** The list shows organizers, hours, and meeting counts, a separate entry for meetings you organize, and an explanation that attendee lists are not requested. An empty week shows a message instead of charts, without crashing or dividing by zero.
- **Priority:** medium

## 12. Themes, language, window size, and working hours

### ВИД-01 — Follow the Windows theme
- **ID:** ВИД-01
- **Title:** Follow the Windows theme
- **Preconditions:** The app's **Theme** setting is **Windows default**.
- **Steps:**
  1. Switch Windows to a dark theme; inspect the widget and Settings.
  2. Switch back to a light theme.
- **Expected result:** All app windows follow the system appearance. Text is readable in both themes, without white flashes or illegible labels.
- **Priority:** medium

### ВИД-02 — Explicit Light and Dark themes
- **ID:** ВИД-02
- **Title:** Explicit Light and Dark themes
- **Preconditions:** Settings is open.
- **Steps:**
  1. Select **Light**, save, and inspect every window.
  2. Select **Dark**, save, and inspect them again.
- **Expected result:** The chosen theme applies to all windows immediately, independently of Windows, and persists after restarting the app.
- **Priority:** medium

### ВИД-03 — Switch interface language
- **ID:** ВИД-03
- **Title:** Switch interface language
- **Preconditions:** Settings is open.
- **Steps:**
  1. Select **English** as Language and save.
  2. Inspect the tray window, Settings, Create meeting, Find free time, and tray tooltip.
  3. Switch back to Russian using the corresponding language option.
- **Expected result:** Localized interface labels, tray tooltips, and notification text switch to the chosen language without untranslated labels. **Windows default** uses the Windows language. Native confirmations and some connection errors may remain in Russian; record them separately from missing translations in the localized interface.
- **Priority:** medium

### ВИД-04 — Three tray window sizes
- **ID:** ВИД-04
- **Title:** Three tray window sizes
- **Preconditions:** Settings is open.
- **Steps:**
  1. Select **Compact** and open the tray window.
  2. Repeat with **Regular** and **Large**.
- **Expected result:** The window resizes immediately after saving, without restarting. At every size, the timeline, footer, and buttons are fully visible, with no horizontal scrolling.
- **Priority:** low

### ВИД-05 — Change working hours
- **ID:** ВИД-05
- **Title:** Change working hours
- **Preconditions:** Settings is open; working hours are the default 08:00–20:00.
- **Steps:**
  1. Set working hours to 10:00–16:00 and save.
  2. Open the tray window and Find free time.
- **Expected result:** The timeline shows 10:00–16:00, expanding only for meetings outside that range. The availability grid contains only columns between 10:00 and 16:00.
- **Priority:** medium

### ВИД-06 — Refresh interval
- **ID:** ВИД-06
- **Title:** Refresh interval
- **Preconditions:** Settings is open.
- **Steps:**
  1. Set **Refresh calendar** to every two minutes and save.
  2. Wait five minutes and inspect the log.
- **Expected result:** Successful synchronization entries appear approximately every two minutes. The footer shows **Synced just now** or **Synced 1 min ago**.
- **Priority:** medium

---

## 13. Startup and quitting

### АВТО-01 — Start when signing in to Windows
- **ID:** АВТО-01
- **Title:** Start when signing in to Windows
- **Preconditions:** The installed build has **Start when I sign in to Windows** enabled.
- **Steps:**
  1. Restart the computer and sign in to Windows.
  2. Inspect the notification area.
- **Expected result:** The app starts automatically and its icon appears, but the tray window does **not** open automatically.
- **Priority:** medium

### АВТО-02 — Disable automatic startup
- **ID:** АВТО-02
- **Title:** Disable automatic startup
- **Preconditions:** АВТО-01 is complete.
- **Steps:**
  1. Disable the startup switch and save Settings.
  2. Restart the computer.
- **Expected result:** The app does not start after Windows sign-in. Its entry in **Task Manager → Startup apps** is absent or disabled.
- **Priority:** medium

### АВТО-03 — Closing a window does not quit the app
- **ID:** АВТО-03
- **Title:** Closing a window does not quit the app
- **Preconditions:** Both the tray window and Settings are open.
- **Steps:**
  1. Close Settings.
  2. Close the tray window with its close button.
  3. Inspect the notification area.
- **Expected result:** The tray icon remains, the app keeps running, and reminders continue arriving.
- **Priority:** medium

### АВТО-04 — Quit from the tray menu
- **ID:** АВТО-04
- **Title:** Quit from the tray menu
- **Preconditions:** The app is running.
- **Steps:**
  1. Right-click the tray icon and choose **Quit**.
  2. Check Task Manager for remaining `OWA Widget.exe` processes.
- **Expected result:** The icon disappears, all app processes exit, and reminders stop.
- **Priority:** high

---

## 14. Diagnostics

### ДИАГ-01 — Open the log folder
- **ID:** ДИАГ-01
- **Title:** Open the log folder
- **Preconditions:** The app has been running for at least several minutes.
- **Steps:**
  1. Open **Settings → Diagnostics → Open log folder**.
- **Expected result:** File Explorer opens `%APPDATA%\OWA Widget\logs` with `owa-widget.log` selected. Settings also shows the file path.
- **Priority:** medium

### ДИАГ-02 — Check log redaction and the safe public support report
- **ID:** ДИАГ-02
- **Title:** Check log redaction and the safe public support report
- **Preconditions:** The app has used a real server for sign-in, synchronization, notifications, and meeting creation.
- **Steps:**
  1. Open the log in Notepad.
  2. Search for your password, a meeting title, an invitation recipient's address, and the word `Cookie`.
  3. In **Settings → Diagnostics**, click **Copy support report** and expand **Report contents**. Compare the preview and clipboard text, checking for internal server URLs, certificate details, credentials, paths, and meeting contents.
- **Expected result:** The password, cookies, meeting titles and contents, and recipient addresses do not occur in the log. It may contain request URLs without query parameters, status codes, failure reasons, and counters such as `sync: ok, 42 events`, `toast: handed to Windows`, and `changes: 2 new`. Internal server addresses and certificate details can still occur there: the raw log is not automatically safe to publish. The separate support report contains technical state and codes, with no internal URLs, certificate details, credentials, paths, or meeting contents. Prefer that reviewed report for public issues; review and redact any log excerpt before sharing it.
- **Priority:** high

### ДИАГ-03 — Limit the log size
- **ID:** ДИАГ-03
- **Title:** Limit the log size
- **Preconditions:** The log is close to 1 MB; this can occur naturally during a long run.
- **Steps:**
  1. Inspect the log folder after the file exceeds 1 MB.
- **Expected result:** `owa-widget.log.1` appears beside `owa-widget.log`, and the current file starts over. Old copies do not accumulate; the folder retains the current log and one rotated copy.
- **Priority:** low

### ДИАГ-04 — Reset cache
- **ID:** ДИАГ-04
- **Title:** Reset cache
- **Preconditions:** The app is connected, meetings are loaded, and a password is saved.
- **Steps:**
  1. Open **Settings → Diagnostics → Reset cache**.
  2. Wait a few seconds and open the tray window.
  3. Reopen Settings.
- **Expected result:** A cache-reset message appears and meetings load again, matching OWA. Password, server address, trusted certificate, and other settings remain unchanged.
- **Priority:** high

---

## 15. Updating and uninstalling

### ОБНОВ-01 — Install a new version over the old one
- **ID:** ОБНОВ-01
- **Title:** Install a new version over the old one
- **Preconditions:** An earlier version is installed, the server is configured, a password is saved, and meetings are cached.
- **Steps:**
  1. Download and run the new installer without uninstalling the old version.
  2. Open Settings after installation.
- **Expected result:** The old copy exits automatically and the new version installs. Server address, login, saved password, trusted certificate, and other settings remain. Sign-in works without re-entering the password.
- **Priority:** high

### ОБНОВ-02 — Update the portable build
- **ID:** ОБНОВ-02
- **Title:** Update the portable build
- **Preconditions:** An older portable build is running.
- **Steps:**
  1. Extract the new archive into a different folder.
  2. Run `OWA Widget.exe` from that folder.
- **Expected result:** The old copy exits and the new copy starts. Settings and password remain because they are in the user profile, not beside the executable.
- **Priority:** medium

### ОБНОВ-03 — Uninstalling the installed build removes its data
- **ID:** ОБНОВ-03
- **Title:** Uninstalling the installed build removes its data
- **Preconditions:** The installed build has been configured and used.
- **Steps:**
  1. Quit the app through **Quit**.
  2. Uninstall it through **Settings → Apps** in Windows.
  3. Check `%APPDATA%\OWA Widget`.
- **Expected result:** The app and Start menu shortcut are removed. `%APPDATA%\OWA Widget`, including settings, encrypted password, cache, and log, is deleted.
- **Priority:** high

### ОБНОВ-04 — Remove the portable build
- **ID:** ОБНОВ-04
- **Title:** Remove the portable build
- **Preconditions:** The portable build has been configured and used.
- **Steps:**
  1. Quit the app through **Quit**.
  2. Delete the program folder.
  3. Delete `%APPDATA%\OWA Widget`.
- **Expected result:** After both folders are removed, no settings, password, or log remains. A fresh launch behaves like first launch.
- **Priority:** medium

---

## 16. Security

### БЕЗОП-01 — All three confirmation dialogs are native
- **ID:** БЕЗОП-01
- **Title:** All three confirmation dialogs are native
- **Preconditions:** You can trigger a server change, certificate trust, and sending invitations.
- **Steps:**
  1. Open each of the three confirmation dialogs in turn.
  2. In each, press Esc without clicking a button.
- **Expected result:** All three are rendered by Windows as separate dialogs with native buttons, rather than app-page content. In every dialog, cancellation is the default, and Esc cancels.
- **Priority:** high

### БЕЗОП-02 — Too many consecutive confirmation requests
- **ID:** БЕЗОП-02
- **Title:** Too many consecutive confirmation requests
- **Preconditions:** You can repeatedly attempt to send a meeting with attendees.
- **Steps:**
  1. Start sending 12 times in succession and cancel each confirmation.
  2. Attempt to send a thirteenth time.
- **Expected result:** The thirteenth attempt opens no confirmation dialog. A message says there have been too many send requests and asks you to wait several minutes.
- **Priority:** medium

### БЕЗОП-03 — Show an unfamiliar link's actual hostname everywhere
- **ID:** БЕЗОП-03
- **Title:** Show an unfamiliar link's actual hostname everywhere
- **Preconditions:** A meeting with an unfamiliar link starts in less than 30 minutes.
- **Steps:**
  1. Inspect the next-meeting card in the tray window.
  2. Open meeting details.
  3. Inspect the tray icon's menu.
  4. Wait for a reminder, or trigger one by choosing a ten-minute reminder.
- **Expected result:** All four locations show the same actual hostname beside Join. None lets you open the link without seeing its destination.
- **Priority:** high

### БЕЗОП-04 — Links impersonating trusted addresses
- **ID:** БЕЗОП-04
- **Title:** Links impersonating trusted addresses
- **Preconditions:** The second mailbox sent an invitation containing `https://teams.microsoft.com@evil.example/join` and `https://evil.example/?u=https://zoom.us/j/1` in its description.
- **Steps:**
  1. Open details and hover over each link.
  2. Inspect the hostname on Join, if that button is present.
- **Expected result:** The app never presents either link as Teams or Zoom. It either does not make the URL clickable or honestly displays `evil.example` beside it.
- **Priority:** high

### БЕЗОП-05 — Calendar traffic stays on Exchange; update checks require a click
- **ID:** БЕЗОП-05
- **Title:** Calendar traffic stays on Exchange; update checks require a click
- **Preconditions:** A network-monitoring tool is available, for example the Network tab in Windows Resource Monitor.
- **Steps:**
  1. Launch the app, connect to the server, and use it for ten minutes: refresh the calendar, search, create a meeting, and find free time. Do not click Check for updates yet.
  2. Inspect the destinations contacted by the app process.
  3. Click **Settings → Updates → Check for updates**, then inspect the new request and its session.
- **Expected result:** Calendar operations use only the configured Exchange server over HTTPS. Startup, opening Settings, and ordinary calendar use cause no update, analytics, or unrelated-site requests. Clicking Check for updates explicitly makes one request to the fixed GitHub releases API in a separate session, without Exchange cookies, credentials, or calendar contents. It does not download or install an update automatically. Links deliberately opened by the tester run in the separate default browser.
- **Priority:** high

### БЕЗОП-06 — Password is not stored as plaintext
- **ID:** БЕЗОП-06
- **Title:** Password is not stored as plaintext
- **Preconditions:** A password has been saved in Settings.
- **Steps:**
  1. Open `%APPDATA%\OWA Widget`.
  2. Open the files in Notepad and search for your password as ordinary text.
- **Expected result:** No file contains the readable password. The password file appears as unreadable bytes.
- **Priority:** high

### БЕЗОП-07 — Meeting cache is encrypted
- **ID:** БЕЗОП-07
- **Title:** Meeting cache is encrypted
- **Preconditions:** Several meetings with recognizable titles have loaded.
- **Steps:**
  1. Search the files in `%APPDATA%\OWA Widget` for a meeting title.
- **Expected result:** Meeting titles are unreadable in the cache files.
- **Priority:** medium

---

## 17. Performance and memory

### ПРОИЗ-01 — Idle memory use
- **ID:** ПРОИЗ-01
- **Title:** Idle memory use
- **Preconditions:** The app is running and connected; all additional windows are closed; it has run for ten minutes.
- **Steps:**
  1. Find the **OWA Widget** process group in Task Manager and inspect total memory.
- **Expected result:** Approximately 70–90 MB total, with two processes: main and network. There should be no separate graphics process or hidden tray-window renderer. The icon and tooltip keep updating.
- **Priority:** medium

### ПРОИЗ-02 — Closing windows releases memory
- **ID:** ПРОИЗ-02
- **Title:** Closing windows releases memory
- **Preconditions:** The app is running.
- **Steps:**
  1. Record memory use.
  2. Open Settings, Create meeting, and Find free time; record memory again.
  3. Close all three, wait one minute, and inspect memory again.
- **Expected result:** Each open window adds approximately 100 MB. Closing them returns memory approximately to baseline, without growth on successive repetitions. The tray window similarly adds about 60 MB while open; three minutes after it is hidden, memory returns to baseline.
- **Priority:** medium

### ПРОИЗ-03 — Long-running session
- **ID:** ПРОИЗ-03
- **Title:** Long-running session
- **Preconditions:** The app is configured.
- **Steps:**
  1. Leave it running for an eight-hour working day, opening the window occasionally.
  2. At the end of the day, inspect memory, the log, and functionality.
- **Expected result:** Memory has not multiplied, the tray countdown is correct, reminders arrive, and the log contains no repeating errors.
- **Priority:** medium

### ПРОИЗ-04 — A hostile invitation does not freeze the app
- **ID:** ПРОИЗ-04
- **Title:** A hostile invitation does not freeze the app
- **Preconditions:** The second mailbox sent an invitation with a 100,000-character description containing many repeated links and brackets.
- **Steps:**
  1. Wait for synchronization, open the tray window, and open that meeting's details.
  2. Scroll through the description.
- **Expected result:** The window opens without freezing. The entire description is displayed, partly as plain text without clickable links. Scrolling works and the app does not consume excessive CPU.
- **Priority:** high

---

## 18. Accessibility and keyboard

### ДОСТ-01 — Navigate Settings with Tab
- **ID:** ДОСТ-01
- **Title:** Navigate Settings with Tab
- **Preconditions:** Settings is open and the mouse is not used.
- **Steps:**
  1. Use Tab to traverse every field and button from top to bottom.
  2. Change values with Space and arrow keys.
- **Expected result:** Every control has visible focus. Navigation order matches screen order. All switches and dropdowns can be changed with the keyboard.
- **Priority:** medium

### ДОСТ-02 — Fill in Create meeting using only the keyboard
- **ID:** ДОСТ-02
- **Title:** Fill in Create meeting using only the keyboard
- **Preconditions:** Create meeting is open.
- **Steps:**
  1. Enter a subject, Tab to date and time, and fill them in.
  2. Type two letters in an attendee field and select a suggestion using arrows and Enter.
  3. Press Ctrl+Enter and approve the native confirmation to send.
- **Expected result:** All fields are usable without a mouse and suggestions can be chosen with arrows. Ctrl+Enter starts submission and opens the required native confirmation; sending occurs only after approval. Ordinary Enter in a field does **not** send a meeting.
- **Priority:** medium

### ДОСТ-03 — Esc closes windows
- **ID:** ДОСТ-03
- **Title:** Esc closes windows
- **Preconditions:** Meeting details, Create meeting, and a reminder window are open.
- **Steps:**
  1. Press Esc in meeting details.
  2. Press Esc in Create meeting with its suggestion list closed.
  3. Press Esc in the reminder window.
- **Expected result:** Details closes back to the timeline; Create meeting closes; the reminder closes. If the attendee suggestion list is open, the first Esc closes only that list.
- **Priority:** medium

### ДОСТ-04 — Screen reader labels
- **ID:** ДОСТ-04
- **Title:** Screen reader labels
- **Preconditions:** Windows Narrator is enabled.
- **Steps:**
  1. Tab through the tray window and Settings while listening to the announcements.
- **Expected result:** Each button has a meaningful name, such as **Search**, **Create meeting**, or **Settings**, rather than being announced as unnamed. Switch states are announced.
- **Priority:** medium

### ДОСТ-05 — Readability at 150% scaling with larger Windows text
- **ID:** ДОСТ-05
- **Title:** Readability at 150% scaling with larger Windows text
- **Preconditions:** Display scaling is 150%, and text size is increased in Windows Settings.
- **Steps:**
  1. Open and inspect every app window.
- **Expected result:** Text is not clipped, buttons do not overlap, and scrolling appears where content does not fit. The tray window has no horizontal scrollbar.
- **Priority:** low

---

## What the developer has not verified

These areas are the most likely to reveal problems. The [README](../README.en.md) and
[security documentation](../SECURITY.en.md) identify implementations based on documentation and
checked with automated tests and a mock server, but not validated on the real target system.
Start with these areas:

1. **Windows notifications with buttons and a dropdown.** Reminders and change notifications were
   implemented from documentation and their action logic was tested, but their appearance has not
   been visually verified on a real Windows desktop. Check appearance, **Join**, **Snooze**, and
   **Accept**, the snooze dropdown, and Do not disturb behavior. If anything fails, switch to
   **App window** and report the specific failure.
   → Cases НАПОМ-01…НАПОМ-08 and ИЗМ-01…ИЗМ-06.
2. **Native confirmation for sending invitations.** Its text is covered by tests, but interaction
   on real Windows has not been verified.
   → СОЗД-05, СОЗД-06, СОЗД-07, СОЗД-08, БЕЗОП-01, БЕЗОП-02.
3. **Meeting creation, directory suggestions, and free-time lookup against real Exchange.** EWS
   requests were written from documentation and tested only against a mock server.
   **Create the first meeting without attendees or with only yourself.**
   → All cases in [Creating meetings](#10-creating-meetings) and [Finding free time](#11-finding-free-time).
4. **Blinking and the yellow unanswered-invitation dot on a real Windows taskbar.** Icon images
   are generated and tested, but have not been visually checked in the real tray.
   → ТРЕЙ-01, ТРЕЙ-03, ТРЕЙ-05, ТРЕЙ-07.
5. **Integrated Windows authentication (Kerberos / NTLM) against real Exchange.** → НАСТР-02.
6. **ARM64.** A separate `…-arm64.exe` installer is released, but has not been validated on ARM64.
   If you have such a computer, run all sections and record every difference.
7. **Invitation replies containing text: Reply with a comment and Propose another time against
   real Exchange.** Text is placed in the response request's `NewBodyContent`; the way actual
   Exchange includes it in the organizer's email has been checked only with a mock server.
   → ПРИГЛ-08, ПРИГЛ-09.
8. **Unsupported and never validated:** Exchange Online (Microsoft 365) and separate single
   sign-on portals such as ADFS or Azure AD. The expected behavior is to stop and explain the
   redirection, as in НАСТР-10, rather than attempt sign-in.

## Groups, privacy, diagnostics, and updates

- In Find free time, add two addresses, save a group named **My team**, then close and reopen the
  window. Choosing the group restores attendees and requests their availability. Change its
  members and name, save it, then delete it: current search attendees remain. The group is absent
  on another server or under another login. Groups survive app restarts; if encryption is
  unavailable, an error appears and no plaintext addresses are written.
- Quickly switch between two groups while Exchange responds slowly: old time options must not
  remain available for creating a meeting.
- Open a meeting with a note, Find free time, and Settings. Enable Privacy mode from the tray:
  every window must show only anonymized intervals; a new reminder and the tray tooltip must
  contain no title, name, or link. Restart the app: Privacy mode remains enabled. After disabling
  it, details and forms can be opened again.
- Against a test server, check successful sign-in, an invalid address, an untrusted certificate,
  a wrong password, and calendar access denied. Diagnostics marks the last confirmed stage and
  the failure without presenting later stages as passed. Demo mode marks every stage as not checked.
- Copy the support report and expand its contents: version, operating system, stages, and
  technical codes are present; login, password, URLs, certificate details, paths, and meeting
  contents are absent. Check clipboard behavior on Windows.
- Startup and opening Settings must cause no GitHub request. Clicking Check for updates makes
  exactly one request in an isolated session without cookies or authentication. Test current and
  newer versions, no internet, GitHub rate limiting, oversized responses, and redirects.
  Downloading and installation must not start automatically.

## Large calendar window

- Open **Calendar…** from the tray menu: it opens maximized. Restore its size, move it to another
  monitor, minimize it, and reopen it from the tray: the same window is reused. Close it and
  check that the app remains in the tray.
- Open meeting details in the widget and click **Expand calendar**: the selected day and meeting
  open in the large window, with the schedule scrolled to the meeting. Repeat with another day
  while the large window is already open.
- Test search with the mouse, Ctrl+F, arrows, and Enter; Esc clears the query. Choose a day with
  no loaded meetings: the UI must say that no loaded data is available, rather than promise a
  free day.
- Edit a personal note and immediately select another meeting. Return: the note is saved.
  Check invitation responses and the right-click copy menu.
- With details open, enable Privacy mode from the tray. Titles, attendees, links, and notes are
  hidden in every window. Disable it: the ordinary calendar returns.
- Check Light and Dark themes and a 900 × 600 window at 100% and 150% Windows scaling.
