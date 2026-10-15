# Linting and formatting

[Русский](LINTING.md) · English

The project uses `arui-presets-lint`: ESLint with type-aware checks, Stylelint and Prettier. These tools are development dependencies and are not bundled into the app.

```sh
yarn lint          # Check JS/TS, CSS and formatting without editing files
yarn lint:fix      # Apply lint fixes and format code
yarn format        # Format code only
yarn typecheck
yarn test
yarn build
```

After applying automatic fixes, review the diff and run type checks and tests. Some syntax changes require manual corrections. CI runs `yarn lint` and allows no warnings.

## Preset adaptations

- ESLint uses both existing TypeScript projects: renderer and Electron/tests. Type-aware checks stay enabled.
- Modules keep camelCase names and components keep PascalCase names; new filenames are also checked. App dependencies live in devDependencies because esbuild and Vite bundle them.
- `void` is allowed as a statement for explicitly fire-and-forget work; floating-promise checks remain enabled. Increment operators are allowed in a loop's update expression.
- Conditional UI labels and paired translations may use nested ternaries. CLI scripts may write results to the console.
- Existing large modules have explicit size and complexity ceilings in `eslint.config.mjs`. These are starting boundaries for gradual refactoring; new modules use the preset defaults. The formatting migration does not require simultaneously splitting protocol parsers and screens into new modules.
- Local exceptions explain intentional bitwise operations, sequential requests, malicious test fixtures and Electron behavior. Hooks, accessibility and type checks are not disabled across the whole project.
- Stylelint checks the app's own Windows theme. Only five rules requiring Alfa Core tokens and mixins are disabled for UI CSS because the app does not use `@alfalab/core-components`. When loaded, the preset's plugin may suggest installing that library; it is not needed for the checks to pass.

The preset's standard formatting command covers TS/JS, CSS and JSON. It does not rewrite Markdown, YAML or HTML. The app's HTML deliberately preserves the exact Content Security Policy.

The [dependency patch notes](../.yarn/patches/README.en.md) explain the local transitive dependency fix and the single audit exception.
