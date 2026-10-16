# Release descriptions

[Русский](README.md) | English

Each published release has a Russian description and a matching English translation. The Russian file becomes the GitHub Release body: user-facing changes first, then an expandable section for installation and file verification. Its English link opens the matching translated file in the repository. The English file is not published as a second release body.

## Preparing a new version

1. Update `version` in `package.json` and run `yarn install` to check consistency with `yarn.lock`.
2. Create both release-note files for the same version from [the Russian template](TEMPLATE.md) and [the English template](TEMPLATE.en.md). For example, the 1.5.0 release uses `docs/releases/v1.5.0.md` and `docs/releases/v1.5.0.en.md`.
3. Describe changes since the previous release in both languages: new features, fixes and important limitations. Replace every unfinished template entry and version placeholder, check installer names, and remove sections that do not apply. Keep the language links paired. The Russian description must link to the English file on `master` so it is accessible from GitHub Releases.
4. Run `node scripts/release-notes.mjs --check` and the usual project checks. The script validates the Russian release body used for publication; also review the English translation for completeness, placeholders and correct links.
5. After pushing to `master`, the **Build** workflow checks the Russian description and passes it, with the build artifacts, to the publication step. A missing file for the current version, a missing change list or leftover placeholders causes the check to fail.

Release text is not taken from commit titles or generated from a generic product description. Both language versions live alongside the code and are reviewed with the changes.

English translations added later do not exist in older release tags. Link to the [current English security policy](https://github.com/dmitrbrvsk/win-owa-widget/blob/master/SECURITY.en.md) on `master`; do not imply that it describes the exact state of an old release. Keep source links pinned to their original release tags where those tags exist.

## Correcting a published description

Edit both matching language files and push to `master`. The **Release notes** workflow updates the body of an existing published release from its Russian file; its English link opens the updated translation. The workflow can also be started manually in GitHub Actions.

Synchronization changes only the description field: it does not create or delete releases, move tags, change installers or publication dates, or change which release is the latest. It creates nothing for a version that has not been published yet; the normal **Build** publication uses that description later.

## Overall release history

When preparing a version, update both [CHANGELOG.md](../../CHANGELOG.md) and [CHANGELOG.en.md](../../CHANGELOG.en.md): briefly describe notable user-facing changes and move them from the Unreleased section under the version number. Use the publication date in Moscow time. The GitHub Release description contains version details and installation instructions; the changelog keeps the overall history without repeating installation instructions.

If CI fails before publication, fix the cause and rebuild with the same version number. Do not reuse an already published number for different contents. Do not list prepared but unpublished versions as completed releases; explain a gap alongside the actual published version when necessary.
