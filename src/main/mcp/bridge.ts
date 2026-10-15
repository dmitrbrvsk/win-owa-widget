import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import {
    BRIDGE_PATH,
    type BridgeConnection,
    isRecord,
    MAX_REQUEST_BYTES,
    MAX_RESPONSE_BYTES,
    REQUEST_CONTEXT,
    RESPONSE_CONTEXT,
    seal,
    unseal,
} from '../../mcp/wire';
import { RequestGate } from '../limits';

export interface ReadBridge {
    connection: BridgeConnection;
    close(): void;
}

function allowed(req: IncomingMessage, port: number): boolean {
    return (
        req.method === 'POST' &&
        req.url === BRIDGE_PATH &&
        req.headers.host === `127.0.0.1:${port}` &&
        req.socket.remoteAddress === '127.0.0.1' &&
        req.headers.origin === undefined &&
        req.headers['content-type'] === 'application/json' &&
        req.headers['content-encoding'] === undefined &&
        Number(req.headers['content-length']) <= MAX_REQUEST_BYTES
    );
}

export async function startReadBridge(
    read: (tool: string, args: unknown) => Record<string, unknown>,
): Promise<ReadBridge> {
    const key = randomBytes(32).toString('base64url');
    const gate = new RequestGate(4, 120, 60_000);
    const seen = new Set<string>();
    let pendingBodies = 0;
    let active = true;
    let port = 0;
    const server = createServer({ maxHeaderSize: 4096 }, (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json');
        if (!active || !allowed(req, port)) {
            res.writeHead(403, { Connection: 'close' }).end('{}');
            return;
        }
        // Bound unauthenticated work without spending the authenticated operation budget.
        if (pendingBodies >= 4) {
            res.writeHead(429, { Connection: 'close' }).end('{}');
            return;
        }
        pendingBodies += 1;
        req.once('close', () => {
            pendingBodies -= 1;
        });
        let size = 0;
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_REQUEST_BYTES) {
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('error', () => res.destroy());
        req.on('end', () => {
            if (!active || res.destroyed) return;
            answer(Buffer.concat(chunks).toString('utf8'), res);
        });
    });

    function answer(body: string, res: ServerResponse) {
        let release: (() => void) | undefined;
        try {
            const raw = unseal(body, key, REQUEST_CONTEXT);
            if (
                !isRecord(raw) ||
                typeof raw.id !== 'string' ||
                !/^[a-f\d-]{36}$/.test(raw.id) ||
                typeof raw.tool !== 'string' ||
                raw.tool.length > 40 ||
                !isRecord(raw.args) ||
                Object.keys(raw).length !== 3 ||
                seen.has(raw.id)
            )
                throw new Error('Invalid request');
            try {
                release = gate.enter();
            } catch {
                res.writeHead(429, { Connection: 'close' }).end('{}');
                return;
            }
            seen.add(raw.id);
            // This is a read-only replay guard, not an unbounded history of client activity.
            if (seen.size > 256) seen.delete(seen.values().next().value!);
            const result = read(raw.tool, raw.args);
            const response = seal({ id: raw.id, result }, key, RESPONSE_CONTEXT + raw.id);
            if (Buffer.byteLength(response) > MAX_RESPONSE_BYTES) throw new Error('Result limit');
            res.end(response);
        } catch {
            res.writeHead(400, { Connection: 'close' }).end('{}');
        } finally {
            release?.();
        }
    }

    server.requestTimeout = 3000;
    server.headersTimeout = 3000;
    server.keepAliveTimeout = 1;
    server.maxConnections = 8;
    server.on('connection', (socket) => {
        // Activity resets the idle timeout; this independent deadline also stops header/body drips.
        const deadline = setTimeout(() => socket.destroy(), 3000);
        deadline.unref();
        socket.once('close', () => clearTimeout(deadline));
        socket.setTimeout(3000, () => socket.destroy());
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.removeListener('error', reject);
            resolve();
        });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Bridge unavailable');
    port = address.port;
    // Runtime errors close access; they never escape as unhandled EventEmitter errors.
    server.on('error', () => {
        active = false;
        server.close();
        server.closeAllConnections();
    });
    return {
        connection: { format: 1, port, key },
        close: () => {
            active = false;
            seen.clear();
            server.close();
            server.closeAllConnections();
        },
    };
}
