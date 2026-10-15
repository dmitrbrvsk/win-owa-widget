# Changelog

[Русский](CHANGELOG.md) | English

Notable OWA Widget changes for users and contributors, from newest to oldest. Publication dates use Moscow time (UTC+3).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Installation instructions and build files are available in [GitHub Releases](https://github.com/dmitrbrvsk/win-owa-widget/releases).

## [Unreleased]

### Added

- Full English documentation, a bug report form and language links; the English README includes product demos.
- MIT license, a safe bug report form, a short English README and compatibility information before installation.
- Build, version and license badges, and direct links to available files in release descriptions.
- ESLint, Stylelint and Prettier from `arui-presets-lint`, checking and formatting commands, and a required CI check.

### Fixed

- Consistent code formatting; clarified React hook dependencies, list keys and interface handlers. Icons use JSX instead of inserted HTML.
- A local `braces` patch bounds pattern nesting; added regression checks for this development-tool dependency.
- Removed outdated duplicate release instructions; the safe support report is now the standard way to report problems.

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

[Unreleased]: https://github.com/dmitrbrvsk/win-owa-widget/compare/v1.4.4...master
[1.4.4]: https://github.com/dmitrbrvsk/win-owa-widget/releases/tag/v1.4.4
[1.4.3]: https://github.com/dmitrbrvsk/win-owa-widget/releases/tag/v1.4.3
[1.4.2]: https://github.com/dmitrbrvsk/win-owa-widget/releases/tag/v1.4.2
[1.4.0]: https://github.com/dmitrbrvsk/win-owa-widget/releases/tag/v1.4.0
[1.3.0]: https://github.com/dmitrbrvsk/win-owa-widget/releases/tag/v1.3.0
[1.2.0]: https://github.com/dmitrbrvsk/win-owa-widget/releases/tag/v1.2.0
[1.1.1]: https://github.com/dmitrbrvsk/win-owa-widget/releases/tag/v1.1.1
[1.1.0]: https://github.com/dmitrbrvsk/win-owa-widget/releases/tag/v1.1.0
[1.0.0]: https://github.com/dmitrbrvsk/win-owa-widget/releases/tag/v1.0.0
