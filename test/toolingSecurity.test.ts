import { spawnSync } from 'node:child_process';
import { globSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Check every installed copy so another descriptor cannot bypass the patched resolution.
const bracesPaths = globSync('node_modules/**/braces/package.json').map((file) =>
    path.resolve(path.dirname(file)),
);
if (!bracesPaths.length) throw new Error('The lint dependency braces was not found');

// Keep this in a child: a lost depth guard must fail CI, including a cyclic-AST hang.
function probe(code: string, bracesPath: string) {
    const result = spawnSync(process.execPath, ['-e', code, bracesPath], {
        encoding: 'utf8',
        timeout: 3000,
        maxBuffer: 64 * 1024,
    });
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
}

describe.each(bracesPaths)('locally patched braces %s (GHSA-vfj7-8cjw-p6xm)', (bracesPath) => {
    it('rejects deeply nested brace/parenthesis strings through every public API', () => {
        probe(
            `
            const assert = require('node:assert/strict');
            const braces = require(process.argv[1]);
            for (const [open, close] of [['{', '}'], ['(', ')']]) {
                const pattern = open.repeat(4000) + 'a,b' + close.repeat(4000);
                for (const method of ['parse', 'compile', 'expand', 'stringify']) {
                    assert.throws(() => braces[method](pattern), /Brace pattern nesting exceeds limit/);
                }
                assert.throws(() => braces(pattern), /Brace pattern nesting exceeds limit/);
            }
        `,
            bracesPath,
        );
    });

    it('bounds recursive AST walkers and parent-chain cycles', () => {
        probe(
            `
            const assert = require('node:assert/strict');
            const braces = require(process.argv[1]);
            for (const method of ['compile', 'expand', 'stringify']) {
                let ast = { type: 'text', value: 'x' };
                for (let depth = 0; depth < 20000; depth++) ast = { type: 'root', nodes: [ast] };
                assert.throws(() => braces[method](ast), /Brace AST nesting exceeds limit/);
            }
            for (const method of ['compile', 'expand', 'stringify']) {
                const ast = braces.parse('a{b,c}');
                ast.nodes[1].value = [[['malformed value']]];
                assert.throws(() => braces[method](ast), /Expected a string AST value/);
            }
            const parent = { type: 'text' };
            parent.parent = parent;
            assert.throws(() => braces.expand({ type: 'text', parent }), /Brace AST nesting exceeds limit/);
        `,
            bracesPath,
        );
    });

    it('preserves normal expansion and invalid-brace escaping semantics', () => {
        probe(
            `
            const assert = require('node:assert/strict');
            const braces = require(process.argv[1]);
            assert.deepEqual(braces.expand('src/{main,renderer}/**/*.{ts,tsx}'), [
                'src/main/**/*.ts', 'src/main/**/*.tsx',
                'src/renderer/**/*.ts', 'src/renderer/**/*.tsx',
            ]);
            assert.deepEqual(braces.expand('v{1..3}'), ['v1', 'v2', 'v3']);
            assert.equal(braces.stringify('{{a}}', { escapeInvalid: true }), '{{a}}');
            assert.equal(braces.stringify('{a,{b}}', { escapeInvalid: true }), '{a,{b}}');
        `,
            bracesPath,
        );
    });
});
