import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ZOD_VERSION = '4.6.7';
const ENGLISH_EXPORT = 'export { default as en } from "./en.js";';
const LOCALE_EXPORT = /^export \{ default as [A-Za-z]\w* \} from "\.\/[\w-]+\.js";$/;

/**
 * This private CLI exposes no locale selector: both its schemas and SDK errors use Zod's default
 * English. Zod 4.6.7 imports that default directly from en.js; its core namespace additionally keeps
 * every public locale export alive in esbuild. Restrict only that unused export barrel in the MCP
 * production bundle, without touching constructors, parsers, error maps or SDK validation.
 *
 * Re-audit before a Zod update: a new version or barrel implementation must fail this build, rather
 * than silently dropping initialization or a new dependency side effect. Dev/watch stays untouched.
 */
export function englishZodLocalePlugin() {
    return {
        name: 'mcp-english-zod-locale',
        setup(build) {
            build.onLoad({ filter: /[/\\]zod[/\\]v4[/\\]locales[/\\]index\.js$/ }, async (args) => {
                const [source, packageJson] = await Promise.all([
                    readFile(args.path, 'utf8'),
                    readFile(path.resolve(path.dirname(args.path), '../../package.json'), 'utf8'),
                ]);
                const { version } = JSON.parse(packageJson);
                const lines = source.trim().split(/\r?\n/);
                if (
                    version !== ZOD_VERSION ||
                    lines.length !== 63 ||
                    !lines.includes(ENGLISH_EXPORT) ||
                    lines.some((line) => !LOCALE_EXPORT.test(line))
                )
                    throw new Error(
                        'Re-audit MCP English-only locales for this Zod version/barrel.',
                    );
                return {
                    contents: ENGLISH_EXPORT,
                    resolveDir: path.dirname(args.path),
                    loader: 'js',
                };
            });
        },
    };
}
