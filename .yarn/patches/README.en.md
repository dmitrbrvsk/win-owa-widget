# Development-tool dependency fixes

[Русский](README.md) | English

Yarn pins local patches and their checksums in the lockfile; `yarn install --immutable` applies them automatically. These dependencies are used by development and build tools and are not bundled into the app. The standard audit excludes only the two advisories fixed by local patches: npm IDs `1240992` and `1241202`. The registry identifies issues by package version and does not account for patch contents. Other high/critical issues continue to block CI.

## braces 3.0.3

`arui-presets-lint` uses `micromatch`, which depends on `braces`. As of October 16, 2026, there is no published fixed version for [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

The patch limits the parser stack, recursive compile/expand/stringify walks and parent chains in expand to 128 levels. Excessive nesting produces a controlled error instead of a stack overflow or hang. The limit applies to both braces and parentheses; `escapeInvalid` behavior is preserved.

`test/toolingSecurity.test.ts` checks every public method, a supplied AST and a parent cycle in a child process with a timeout, as well as ordinary patterns. The tests fail without the patch. Audit exception: npm ID `1240992` only.

Once a fixed upstream package is released, update the dependency and remove the patch, resolution and exception `1240992`. The regression check can be retained for the new version.

## sprintf-js 1.1.3

The `electron-builder` → `@electron/get` → `global-agent` → `roarr` chain uses `sprintf-js`. As of October 16, 2026, there is no published fixed version for [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c).

The patch changes only numeric precision for `%e`, `%f` and `%g`: before passing it to the built-in Number methods, it clamps precision to **0–100 for e/f** and **1–100 for g**. A long digit string that becomes `Infinity` selects the upper bound of 100; `%.0g` uses precision 1. Excessive precision therefore does not throw a `RangeError`. Formats without precision, valid precision, signs, alignment, padding and nonnumeric conversions retain their previous behavior. Field width is unchanged: this patch addresses the precision advisory and does not make arbitrary untrusted format strings safe.

The same protection is applied to the Node entry `src/sprintf.js` and the distributed `dist/sprintf.min.js`. `test/toolingFormattingSecurity.test.ts` checks both entries of every installed copy in child processes with timeouts: precision 101, one billion, 400 digits, zero and ordinary `sprintf`/`vsprintf` formats. Without the patch, the dangerous-precision check fails with a `RangeError`. Audit exception: npm ID `1241202` only; overriding `@electron/get` to an incompatible major version is unnecessary.

Once an upstream fix is available, update the compatible dependency chain, remove the patch, resolution and exception `1241202`, and run the regression tests and build.

## KaTeX 0.18.2

`micromark-extension-math` 3.1.0 still declares `katex: ^0.16.0`. The narrow `katex@npm:^0.16.0` resolution selects **0.18.2**, which fixes [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7). There is no KaTeX audit exception.

`test/toolingFormattingSecurity.test.ts` checks `renderToString`, explicit `trust: true`, rejection of inherited `trust` and polluted `Object.prototype`, and inline/block math through real micromark with `mathHtml`. Dangerous-inheritance checks run in isolated child processes. They reproduced the issue before the update and pass afterward.

Remove the resolution once a compatible `micromark-extension-math` version selects a fixed KaTeX itself. Retain the integration and trust-boundary checks during subsequent updates.
