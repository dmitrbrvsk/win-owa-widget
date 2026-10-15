import { buildSync } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { expect, it } from 'vitest';

import { demoEvents } from '../src/main/demo';
import { type McpCalendarView } from '../src/main/mcp/catalog';
import { McpController } from '../src/main/mcp/controller';

it('runs the bundled Node CLI through stdio, permissions, the real bridge and calendar projection', async () => {
    const root = mkdtempSync(nodePath.join(tmpdir(), 'owa-mcp-cli-'));
    const script = nodePath.join(root, 'index.cjs');
    buildSync({
        entryPoints: ['src/mcp/index.ts'],
        outfile: script,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node24',
        define: { MCP_BUILD_VERSION: JSON.stringify('test') },
    });
    const view: McpCalendarView = {
        account: 'internal-mailbox',
        revision: 1,
        privacyMode: false,
        sync: { phase: 'ok' },
        version: 'test',
        demo: true,
        events: [
            {
                ...demoEvents()[0],
                id: 'secret-exchange-id',
                title: 'Planning fixture',
                start: '2026-10-16T09:00:00Z',
                end: '2026-10-16T10:00:00Z',
                organizerEmail: 'hidden@example.test',
                bodyPreview: 'private body',
            },
        ],
    };
    const directory = nodePath.join(root, 'private');
    const controller = new McpController({
        directory,
        cliPath: script,
        view: () => view,
        confirm: async () => true,
    });
    await controller.setAccess({ enabled: true, allowTitles: false });
    const child = spawn(
        process.execPath,
        [script, '--connection-file', nodePath.join(directory, 'connection.json')],
        {
            stdio: ['pipe', 'pipe', 'pipe'],
        },
    );
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
    });
    let buffered = '';
    const pending = new Map<number, (result: Record<string, unknown>) => void>();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
        buffered += chunk;
        const lines = buffered.split('\n');
        buffered = lines.pop() ?? '';
        for (const line of lines) {
            const message = JSON.parse(line) as Record<string, unknown>;
            if (typeof message.id === 'number') pending.get(message.id)?.(message);
        }
    });
    let sequence = 0;
    function exchange(method: string, params: Record<string, unknown>) {
        sequence += 1;
        const id = sequence;
        return new Promise<Record<string, unknown>>((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error('MCP test timeout'));
            }, 3000);
            pending.set(id, (message) => {
                clearTimeout(timer);
                pending.delete(id);
                resolve(message);
            });
            child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        });
    }
    const args = { start: '2026-10-16T00:00:00Z', end: '2026-10-17T00:00:00Z' };
    const list = () => exchange('tools/call', { name: 'list_meetings', arguments: args });
    try {
        const initialized = await exchange('initialize', {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'fixture', version: '1' },
        });
        expect(initialized.result).toBeDefined();
        child.stdin.write(
            `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
        );
        const redacted = JSON.stringify(await list());
        expect(redacted).toContain('2026-10-16T09:00:00.000Z');
        expect(redacted).not.toMatch(
            /Planning fixture|secret-exchange-id|hidden@example|private body|internal-mailbox/,
        );
        await controller.setAccess({ enabled: true, allowTitles: true });
        expect(JSON.stringify(await list())).toContain('Planning fixture');
        view.privacyMode = true;
        expect(JSON.stringify(await list())).not.toContain('Planning fixture');
        await controller.setAccess({ enabled: false, allowTitles: false });
        expect(await list()).toMatchObject({ result: { isError: true } });
        const exit = new Promise<number | null>((resolve) => {
            child.once('exit', resolve);
        });
        child.stdin.end();
        expect(await exit).toBe(0);
        expect(stderr).toBe('');
        expect(buffered).toBe('');
    } finally {
        child.kill();
        controller.close();
        rmSync(root, { recursive: true, force: true });
    }
}, 10_000);
