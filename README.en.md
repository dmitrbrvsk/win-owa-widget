# OWA Widget

[Русская версия](README.md) · English

Your next Exchange meeting in the Windows tray: a daily timeline, reminders, one-click joining, invitation replies and shared free-time search. The app reads your calendar, not your email.

[Download for Windows](https://github.com/dmitrbrvsk/win-owa-widget/releases/latest) · [Screenshots and demos](README.md#в-работе)

## Compatibility and current status

- Windows 10/11, x64 and ARM64. No administrator rights required. Russian and English interface.
- Corporate Exchange on-premises with OWA, using Windows authentication (Kerberos / NTLM) or an OWA login form. EWS must be available for meeting creation, people lookup and free-time search.
- Microsoft 365 / Exchange Online, modern OAuth authentication and separate SSO portals such as ADFS / Azure AD are not supported.
- CI runs tests, builds the Windows app and checks that its windows open. This does not verify real Exchange integration: authentication and EWS operations still need testing against a real server. Windows notification buttons also need manual validation. Try your first created meeting with no attendees or only yourself; see the [guide (Russian)](docs/GUIDE.md#общие-вопросы).

## Install and connect

1. Open the [latest release](https://github.com/dmitrbrvsk/win-owa-widget/releases/latest) and choose a file:

   | File | Purpose |
   |---|---|
   | `OWA-Widget-Setup-<version>.exe` | Windows x64 installer; also runs on ARM64 through emulation |
   | `OWA-Widget-Setup-<version>-arm64.exe` | Native Windows ARM64 installer |
   | `OWA-Widget-<version>-portable-x64.zip` | No installation: extract and run `OWA Widget.exe` |

2. The installer is **not Authenticode-signed**, so Windows SmartScreen may warn. Before running it, compare its SHA-256 hash with `SHA256SUMS.txt` from the release and verify the build attestation. See the [verification commands](SECURITY.md#как-проверить-скачанный-файл).
3. Start the app and find its tray icon; on Windows 11, it may be under the **^** arrow. Open Settings and enter your company's OWA server, such as `mail.company.ru`, rather than your email address. Replace the default `owa.alfabank.ru` with your own server.
4. Leave both username and password empty for Windows authentication, or enter your OWA credentials. Connect to your corporate VPN if needed.

Updates are manual: download a newer release and run its installer over the existing copy. Portable mode uses an app reminder window by default because Windows notifications are not guaranteed without an installed shortcut. See the [installation and update FAQ (Russian)](docs/GUIDE.md#установка-и-обновление).

## Development demo

Install **Node.js 24.22.0 LTS**, then clone the repository and start the demo. Corepack selects the pinned **Yarn 4.18.1**. The demo uses fictional meetings and needs no Exchange account.

```sh
git clone https://github.com/dmitrbrvsk/win-owa-widget.git
cd win-owa-widget
corepack enable
yarn install --immutable
yarn setup:electron
yarn dev:demo
```

Run `yarn lint`, `yarn typecheck`, `yarn test` and `yarn build` for local checks. `yarn dev` uses a real account; `yarn dist` builds Windows installers and the portable archive on Windows. Architecture and release instructions are in the [developer guide (Russian)](docs/GUIDE.md#для-разработчиков).

## Documentation and support

- [Full README, screenshots and demos (Russian)](README.md)
- [User guide and troubleshooting (Russian)](docs/GUIDE.md)
- [Changelog](CHANGELOG.md)
- [Security and file verification (Russian)](SECURITY.md)
- [MIT license](LICENSE)
- [Report an issue](https://github.com/dmitrbrvsk/win-owa-widget/issues) — include the app version, Windows version and architecture, installation type, and reproduction steps. Do not publish credentials or meeting data.
