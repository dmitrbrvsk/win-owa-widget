import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { startReadBridge } from '../src/main/mcp/bridge';
import { callBridge } from '../src/mcp/bridgeClient';
import { readConnection, writePrivateJson } from '../src/mcp/privateFiles';
import { BRIDGE_PATH, REQUEST_CONTEXT, RESPONSE_CONTEXT, seal, unseal } from '../src/mcp/wire';

const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const close of cleanups.splice(0)) close();
});
function directory() {
    const path = mkdtempSync(nodePath.join(tmpdir(), 'owa-mcp-bridge-'));
    cleanups.push(() => rmSync(path, { recursive: true, force: true }));
    return path;
}
async function bridge() {
    const calls: string[] = [];
    const server = await startReadBridge((tool) => {
        calls.push(tool);
        return { meetings: [] };
    });
    cleanups.push(() => server.close());
    const file = nodePath.join(directory(), 'connection.json');
    writePrivateJson(file, server.connection);
    return { server, file, calls };
}
function post(port: number, body: string, headers: Record<string, string> = {}) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = request(
            {
                hostname: '127.0.0.1',
                port,
                path: BRIDGE_PATH,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    ...headers,
                },
            },
            (res) => {
                let result = '';
                res.setEncoding('utf8');
                res.on('data', (s: string) => {
                    result += s;
                });
                res.on('end', () => resolve({ status: res.statusCode!, body: result }));
            },
        );
        req.on('error', reject);
        req.end(body);
    });
}

describe('private read bridge', () => {
    it('authenticates both directions without sending the key or query in cleartext', async () => {
        const { server, file, calls } = await bridge();
        expect(await callBridge(file, 'get_status', {})).toEqual({ meetings: [] });
        expect(calls).toEqual(['get_status']);
        const id = randomUUID();
        const body = seal(
            { id, tool: 'search_meetings', args: { query: 'private subject' } },
            server.connection.key,
            REQUEST_CONTEXT,
        );
        expect(body).not.toContain('private subject');
        expect(body).not.toContain(server.connection.key);
        const response = await post(server.connection.port, body);
        expect(unseal(response.body, server.connection.key, RESPONSE_CONTEXT + id)).toEqual({
            id,
            result: { meetings: [] },
        });
        expect(() =>
            unseal(response.body, server.connection.key, RESPONSE_CONTEXT + randomUUID()),
        ).toThrow();
        expect((await post(server.connection.port, body)).status).toBe(400);
    });

    it('rejects browser origins, rebinding hosts, unencrypted requests and unknown keys', async () => {
        const { server, calls } = await bridge();
        const body = seal(
            { id: randomUUID(), tool: 'get_status', args: {} },
            server.connection.key,
            REQUEST_CONTEXT,
        );
        const headers: Array<Record<string, string>> = [
            { Origin: 'http://localhost' },
            { Origin: 'null' },
            { Host: 'evil.example' },
        ];
        const denied = await Promise.all(
            headers.map((value) => post(server.connection.port, body, value)),
        );
        expect(denied.map((value) => value.status)).toEqual([403, 403, 403]);
        expect((await post(server.connection.port, '{}')).status).toBe(400);
        const wrong = seal(
            { id: randomUUID(), tool: 'get_status', args: {} },
            randomBytes(32).toString('base64url'),
            REQUEST_CONTEXT,
        );
        expect((await post(server.connection.port, wrong)).status).toBe(400);
        expect(calls).toEqual([]);
    });

    it('rejects oversized input before reading calendar data and closes revoked connections', async () => {
        const { server, file, calls } = await bridge();
        expect((await post(server.connection.port, 'x'.repeat(17 * 1024))).status).toBe(403);
        expect(calls).toEqual([]);
        server.close();
        await expect(callBridge(file, 'get_status', {})).rejects.toThrow('MCP unavailable');
    });

    it('does not trust a different process occupying a stale port', async () => {
        let captured = '';
        const fake = createServer((req, res) => {
            req.setEncoding('utf8');
            req.on('data', (s: string) => {
                captured += s;
            });
            req.on('end', () => res.end(JSON.stringify({ result: { meetings: ['forged'] } })));
        });
        await new Promise<void>((resolve, reject) => {
            fake.once('error', reject);
            fake.listen(0, '127.0.0.1', resolve);
        });
        cleanups.push(() => {
            fake.close();
            fake.closeAllConnections();
        });
        const address = fake.address();
        if (!address || typeof address === 'string') throw new Error('Missing test port');
        const key = randomBytes(32).toString('base64url');
        const file = nodePath.join(directory(), 'connection.json');
        writePrivateJson(file, { format: 1, port: address.port, key });
        await expect(
            callBridge(file, 'search_meetings', { query: 'secret subject' }),
        ).rejects.toThrow('MCP unavailable');
        expect(captured).not.toContain(key);
        expect(captured).not.toContain('secret subject');
    });

    it('rejects non-private, linked and oversized connection files', () => {
        const root = directory();
        const file = nodePath.join(root, 'connection.json');
        writeFileSync(file, 'x'.repeat(4097), { mode: 0o600 });
        expect(() => readConnection(file)).toThrow();
        writePrivateJson(file, {
            format: 1,
            port: 1234,
            key: randomBytes(32).toString('base64url'),
        });
        if (process.platform !== 'win32') {
            chmodSync(file, 0o644);
            expect(() => readConnection(file)).toThrow();
            chmodSync(file, 0o600);
            const link = nodePath.join(root, 'link.json');
            symlinkSync(file, link);
            expect(() => readConnection(link)).toThrow();
        }
    });
});
