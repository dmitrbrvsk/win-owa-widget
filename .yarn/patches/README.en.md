# Local braces 3.0.3 patch

[Русский](README.md) | English

`arui-presets-lint` uses `micromatch`, which depends on `braces`. As of October 16, 2026, there is no published fixed version for [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

The patch limits the parser stack, recursive compile/expand/stringify walks and parent chains in expand to 128 levels. Excessive nesting produces a controlled error instead of a stack overflow or hang. The limit applies to both braces and parentheses; `escapeInvalid` behavior is preserved.

`test/toolingSecurity.test.ts` checks every public method, a supplied AST and a parent cycle in a child process with a timeout, as well as ordinary patterns. The tests fail without the patch. Yarn pins the patch and its checksum in the lockfile; `yarn install --immutable` applies it automatically.

Only npm advisory ID `1240992` is excluded from the standard audit report because the registry identifies the issue by version and does not account for the local patch's contents. Other high/critical issues continue to block CI. This is a development-tool dependency and is not included in the app.

Once a fixed upstream package is released, update the dependency and remove the patch, resolution and advisory exception. The regression check can be retained for the new version.
