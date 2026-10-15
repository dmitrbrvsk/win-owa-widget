import { spawnSync } from 'node:child_process';
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function copies(name: string) {
    const installed = globSync(`node_modules/**/${name}/package.json`)
        .filter(
            (file) => (JSON.parse(readFileSync(file, 'utf8')) as { name: string }).name === name,
        )
        .map((file) => path.resolve(path.dirname(file)));
    if (!installed.length) throw new Error(`Missing tooling dependency: ${name}`);
    return installed;
}
function probe(code: string, dependency: string) {
    const result = spawnSync(process.execPath, ['-e', code, dependency], {
        encoding: 'utf8',
        timeout: 3000,
        maxBuffer: 64 * 1024,
    });
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
}

describe.each(
    copies('sprintf-js').flatMap((directory) => [
        directory,
        path.join(directory, 'dist/sprintf.min.js'),
    ]),
)('patched sprintf-js precision in %s', (dependency) => {
    it('bounds oversized, infinite and zero numeric precision without RangeError or a hang', () => {
        probe(
            `
            const assert = require('node:assert/strict');
            const {sprintf} = require(process.argv[1]);
            for (const digits of ['101', '1000000000', '9'.repeat(400)]) {
                assert.equal(sprintf('%.' + digits + 'e', 1.25), (1.25).toExponential(100));
                assert.equal(sprintf('%.' + digits + 'f', 1.25), (1.25).toFixed(100));
                assert.equal(sprintf('%.' + digits + 'g', 1.25), String(Number((1.25).toPrecision(100))));
            }
            assert.equal(sprintf('%.0e', 1.25), '1e+0');
            assert.equal(sprintf('%.0f', 1.25), '1');
            assert.equal(sprintf('%.0g', 1.25), '1');
        `,
            dependency,
        );
    });
    it('preserves ordinary sprintf and vsprintf formats', () => {
        probe(
            `
            const assert = require('node:assert/strict');
            const {sprintf, vsprintf} = require(process.argv[1]);
            assert.equal(sprintf('%.2f / %.2e / %.3g', 1.25, 1.25, 1.25), '1.25 / 1.25e+0 / 1.25');
            assert.equal(sprintf('%+08.2f', 1.25), '+0001.25');
            assert.equal(sprintf('%-8.2f!', -1.25), '-1.25   !');
            assert.equal(vsprintf('%s %04d %x %.3s', ['hello', 12, 255, 'abcdef']), 'hello 0012 ff abc');
            assert.equal(sprintf('%f %g %e', 1.25, 1.25, 1.25), '1.25 1.25 1.25e+0');
        `,
            dependency,
        );
    });
});

describe.each(copies('katex'))('KaTeX trust isolation in %s', (dependency) => {
    it('ignores inherited trust options and polluted Object.prototype while retaining explicit trust', () => {
        probe(
            String.raw`
            const assert = require('node:assert/strict');
            const katex = require(process.argv[1]);
            const input = '\\href{https://fixture.example/link}{fixture}';
            const inherited = Object.create({trust: true});
            assert.ok(!katex.renderToString(input, inherited).includes('href='));
            Object.prototype.trust = true;
            try { assert.ok(!katex.renderToString(input).includes('href=')); }
            finally { delete Object.prototype.trust; }
            assert.ok(katex.renderToString(input, {trust: true}).includes('href="https://fixture.example/link"'));
            assert.ok(katex.renderToString('x^2 + 1').includes('katex'));
        `,
            dependency,
        );
    });
});

it('keeps micromark math rendering compatible with KaTeX and ignores inherited trust', () => {
    probe(
        String.raw`
        const assert = require('node:assert/strict');
        (async () => {
            const {micromark} = await import('micromark');
            const {math, mathHtml} = await import('micromark-extension-math');
            const render = (text) => micromark(text, {extensions:[math()],htmlExtensions:[mathHtml()]});
            assert.ok(render('Inline $x^2$').includes('math-inline'));
            assert.ok(render('$$\nx^2\n$$').includes('math-display'));
            Object.prototype.trust = true;
            try { assert.ok(!render('$\\href{https://fixture.example/link}{fixture}$').includes('href=')); }
            finally { delete Object.prototype.trust; }
        })().catch(error => { console.error(error); process.exitCode=1; });
    `,
        path.resolve('node_modules/katex'),
    );
});
