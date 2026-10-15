[Русский](TEMPLATE.md) | English

**TODO: the main change and its benefit to the user.**

**Download:** [x64](https://github.com/dmitrbrvsk/win-owa-widget/releases/download/v<version>/OWA-Widget-Setup-<version>.exe) · [ARM64](https://github.com/dmitrbrvsk/win-owa-widget/releases/download/v<version>/OWA-Widget-Setup-<version>-arm64.exe) · [Portable](https://github.com/dmitrbrvsk/win-owa-widget/releases/download/v<version>/OWA-Widget-<version>-portable-x64.zip)

## Changes

- **TODO: a new feature or fix.** Explain what is now available or how behavior has changed.

### Important

TODO: limitations, compatibility or steps required when updating. Delete this section if it is not needed.

<details>
<summary>Installation and file verification</summary>

## Installation

- **OWA-Widget-Setup-<version>.exe** — installer for Windows 10/11 x64; runs on ARM64 under emulation. Administrator rights are not required.
- **OWA-Widget-Setup-<version>-arm64.exe** — separate installer for Windows ARM64.
- **OWA-Widget-<version>-portable-x64.zip** — extract and run `OWA Widget.exe` without installation.

## Verify the files

The installer is not yet Authenticode-signed, so Windows SmartScreen may display a warning. Before running it, compare its checksum with `SHA256SUMS.txt` from this release:

```powershell
Get-FileHash .\OWA-Widget-Setup-<version>.exe -Algorithm SHA256
gh attestation verify .\OWA-Widget-Setup-<version>.exe --repo dmitrbrvsk/win-owa-widget
```

</details>

[User guide](https://github.com/dmitrbrvsk/win-owa-widget/blob/master/docs/GUIDE.en.md) · [Current security policy](https://github.com/dmitrbrvsk/win-owa-widget/blob/master/SECURITY.en.md) · [Source](https://github.com/dmitrbrvsk/win-owa-widget/tree/v<version>)
