# Changelog

[Русский](CHANGELOG.md) | English

Notable OWA Widget changes for users and contributors, from newest to oldest. Publication dates use Moscow time (UTC+3).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Installation instructions and build files are available in [GitHub Releases](https://github.com/dmitrbrvsk/win-owa-widget/releases).

## [Unreleased]

## [1.6.0] — 2026-10-25

### New features

- Keyboard shortcuts that work from any program: Ctrl+Alt+J joins the current meeting, Ctrl+Alt+W shows or hides the widget, Ctrl+Alt+N starts a new meeting. Change or turn them off in the settings; combinations held by another program are flagged.
- Free windows on the timeline (in the widget and the large calendar window): gaps of 30 minutes or more within working hours, today's next free window and a warning about 3 hours of meetings with no break. Clicking a window starts a new meeting at that time.
- Frequent people and places in the new meeting form: added in one click and offered first in suggestions.

### Security and data

- Frequent people are stored locally, per account and encrypted; they are hidden in privacy mode and can be deleted in the settings.
- The app registers only the combinations from the settings and does not see any other keyboard input. In privacy mode Ctrl+Alt+J opens no call.

## [1.5.0] — 2026-10-16

### New features

- Local read-only MCP: a connected client can check synchronization status, list loaded meeting times, search permitted titles and retrieve a meeting's allowed fields. Native consent is required; titles need a separate permission, privacy mode hides them and account changes revoke access. [MCP setup](docs/MCP.en.md).
- Recovery for older participant groups and notes: ordinary manual accounts migrate automatically; ambiguous records can be assigned to the selected account through native confirmation.

### Security and data preservation

- Windows SSO and a manual `windows` login no longer share an owner key. Server, sign-in mode and principal are separate; one legacy source cannot be assigned to two accounts.
- Encrypted originals are preserved during migration. Only the reserved owner can resume an interrupted migration; edits remain blocked until completion. Current notes win conflicts and duplicate group names receive a numeric suffix. Unreadable files are not overwritten; ownerless notes remain separate.
- Certificate consent is bound to the displayed server, fingerprint and account revision. Switching accounts during note-deletion consent cannot delete the replacement account's notes.
- An unavailable manual password stops the connection instead of falling back to Windows SSO under a different cache owner.
- JSON structure and parser work are bounded before expensive processing. Invalid MCP requests cannot consume the authenticated operation quota; slow headers and body streams have an absolute deadline.
- Updated KaTeX and added tested local fixes for `braces` and `sprintf-js` in development-tool dependencies.

### Performance and reliability

- Availability preserves manual scrolling during clock and calendar updates, while handling local date and timezone changes.
- Synchronization status updates no longer copy the entire calendar into every window. Account/privacy changes and invitation responses still refresh the affected data.
- Very dense days and all-day meetings use 50-record pages with totals. All meetings remain accessible; overlap layout uses priority queues instead of scanning columns.
- Date formatting reuses formatters. Production JS is minified, screens load separately and MCP keeps only the used English Zod locale while preserving validation. Browser demos use the separate `yarn build:browser-demo` command.
- Opening a meeting from a notification waits for the interface to become ready, including on a cold window.

### Documentation and development

- Added the MIT LICENSE, complete English documentation and safe bug-report forms. Compatibility, build/version/license badges and direct release-file links are visible before installation.
- Added `arui-presets-lint`, consistent formatting and required CI checks. Kept one current release guide and paired release-note templates.

### Updating

- Legacy calendar cache is fetched from the server again. MCP grants stored under the old owner are not restored: grant consent again if needed.
- Ambiguous groups and notes remain separate until you choose “Recover for the current account” in Settings. The older ownerless `notes.bin` is not imported. [Data migration](docs/GUIDE.en.md#migrating-older-account-data).
- MCP is off by default, reads only loaded meetings and requires a separate Node.js 24.22+ runtime within 24.x. An empty result does not prove free time. A connected client may forward permitted data to its provider.

## [1.4.4] — 2026-10-16

### Security

- Moved the interface from `file://` to the internal `owa-widget://app/` scheme. Additional file-scheme privileges are disabled; IPC accepts only the interface page from the new origin.
- The scheme handler serves only the interface HTML and bundled JS/CSS. Other files, other hosts and directory traversal are blocked.

### Reliability

- The packaged Windows build check requires confirmation that the interface has loaded with styles and a working preload, rather than only checking for a running process.

### Documentation

- Added this release history, including an explanation of the skipped 1.4.1 version.
- Updated the manual personal-meeting confirmation scenario.

## [1.4.3] — 2026-10-16

### Security

- Native confirmation is also required for personal meetings without attendees: creation, editing and cancellation. The interface can no longer authorize an external link through an unconfirmed calendar entry.
- Cache clearing and certificate operations no longer release the lock after a failed sign-in. Connection checks also respect and set this lock.
- Retrying sign-in after an error requires native confirmation. Recovery requests are limited to one per 30 seconds; cancellation and saving errors do not authorize further attempts.
- Added regression checks for complete IPC flows, including changing the session during confirmation.

## [1.4.2] — 2026-10-15

### Security

- Results and errors from old requests are rejected after switching accounts; old requests are cancelled, and the previous session's windows and reminders close.
- The calendar cache is account-bound. The lock after an incorrect password applies to all calendar operations, including meeting details, responses and availability requests.
- A full connection reset clears Chromium HTTP authentication and closes old connections before the new client starts work.
- Blocked-navigation logs exclude meeting link paths, query parameters and fragments.

### Fixed

- Cache and note reading errors do not interrupt startup. An unreadable note file is preserved and protected against overwriting.
- Faster sign-in page parsing for input containing repeated headers.
- README now shows the actual meeting statistics screen.

**Why there is no 1.4.1:** the version was prepared, but CI stopped at a performance test; the Windows build and publication did not run. All of its changes were included in 1.4.2 together with subsequent fixes. [Failed run](https://github.com/dmitrbrvsk/win-owa-widget/actions/runs/38662967786).

## [1.4.0] — 2026-10-15

### Added

- A larger calendar window opened from the tray: schedule and meeting card side by side, day selection, local search and familiar meeting actions.
- The selected meeting and day are preserved when opening from the compact widget; privacy mode is available in the larger window.

### Development

- Migrated to Yarn 4 and Node.js 24 LTS with pinned versions and immutable dependency installation.

## [1.3.0] — 2026-10-15

### Added

- Saved attendee groups for quickly finding a shared time, with local encrypted storage separated by account.
- Privacy mode: hides titles, names, addresses and notes in all windows, new notifications and the tray tooltip.
- Step-by-step connection diagnostics and a safe support report.
- Manual update checks through GitHub, without automatic downloading or installation.

### Fixed

- An outdated availability response is not used after changing the attendees or time period.

## [1.2.0] — 2026-10-10

### Added

- Invitation responses with comments and alternative time suggestions, with confirmation before sending.
- Warnings about overlaps with accepted meetings and meetings you organize.
- Personal meeting notes stored locally and never sent to Exchange.

## [1.1.1] — 2026-10-08

### Performance

- The hidden widget window is released after three minutes; the icon, countdown and reminders continue to work in the main process.
- Smaller distribution files by removing unnecessary Chromium language files and separating architectures.

### Added

- Separate Windows ARM64 installer.

## [1.1.0] — 2026-10-08

### Added

- Meeting statistics: hours and share of working time, daily workload, organizers and call platforms.
- Editing and cancelling your meetings, with confirmation of changes and attendee notifications.
- Recurring meetings: daily, on weekdays, weekly and every two weeks; ending on a date or after a number of occurrences.

## [1.0.0] — 2026-10-08

### First published release

- Exchange/OWA calendar in the Windows tray: a daily timeline, the next meeting, invitations and access to calls.
- Meeting creation, address book suggestions and finding a shared free time.
- Local search, a copy menu, countdown and reminders.
- First-run introduction, light and dark themes, and Russian and English interfaces.
- RSVP result confirmation and protection against automatic resending when meeting creation has an uncertain outcome.

[Unreleased]: https://github.com/dmitrbrvsk/win-owa-widget/compare/v1.6.0...master
[1.6.0]: https://github.com/dmitrbrvsk/win-owa-widget/releases/tag/v1.6.0
[1.5.0]: https://github.com/dmitrbrvsk/win-owa-widget/releases/tag/v1.5.0
[1.4.4]: https://github.com/dmitrbrvsk/win-owa-widget/releases/tag/v1.4.4
[1.4.3]: https://github.com/dmitrbrvsk/win-owa-widget/releases/tag/v1.4.3
[1.4.2]: https://github.com/dmitrbrvsk/win-owa-widget/releases/tag/v1.4.2
[1.4.0]: https://github.com/dmitrbrvsk/win-owa-widget/releases/tag/v1.4.0
[1.3.0]: https://github.com/dmitrbrvsk/win-owa-widget/releases/tag/v1.3.0
[1.2.0]: https://github.com/dmitrbrvsk/win-owa-widget/releases/tag/v1.2.0
[1.1.1]: https://github.com/dmitrbrvsk/win-owa-widget/releases/tag/v1.1.1
[1.1.0]: https://github.com/dmitrbrvsk/win-owa-widget/releases/tag/v1.1.0
[1.0.0]: https://github.com/dmitrbrvsk/win-owa-widget/releases/tag/v1.0.0
