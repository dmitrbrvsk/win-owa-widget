import { randomUUID } from 'node:crypto';
import { request } from 'node:http';

import { readConnection } from './privateFiles';
import {
    BRIDGE_PATH,
    isRecord,
    MAX_REQUEST_BYTES,
    MAX_RESPONSE_BYTES,
    REQUEST_CONTEXT,
    RESPONSE_CONTEXT,
    seal,
    unseal,
} from './wire';

export async function callBridge(
    connectionFile: string,
    tool: string,
    args: unknown,
): Promise<Record<string, unknown>> {
    try {
        // Resolve every call: an app restart, revocation or permission change rotates the key.
        const connection = readConnection(connectionFile);
        const id = randomUUID();
        const body = seal({ id, tool, args }, connection.key, REQUEST_CONTEXT);
        if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) throw new Error('Request too large');
        const response = await new Promise<string>((resolve, reject) => {
            const req = request(
                {
                    hostname: '127.0.0.1',
                    port: connection.port,
                    path: BRIDGE_PATH,
                    method: 'POST',
                    agent: false,
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body),
                    },
                },
                (res) => {
                    if (res.statusCode !== 200) {
                        res.resume();
                        reject(new Error('Bridge unavailable'));
                        return;
                    }
                    let size = 0;
                    const chunks: Buffer[] = [];
                    res.on('data', (chunk: Buffer) => {
                        size += chunk.length;
                        if (size > MAX_RESPONSE_BYTES) {
                            req.destroy(new Error('Response too large'));
                            return;
                        }
                        chunks.push(chunk);
                    });
                    res.on('error', reject);
                    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
                },
            );
            const timer = setTimeout(() => req.destroy(new Error('Bridge timeout')), 3000);
            req.on('close', () => clearTimeout(timer));
            req.on('error', reject);
            req.end(body);
        });
        const decoded = unseal(response, connection.key, RESPONSE_CONTEXT + id);
        if (!isRecord(decoded) || decoded.id !== id || !isRecord(decoded.result))
            throw new Error('Invalid bridge response');
        return decoded.result;
    } catch {
        // No filesystem paths, meeting text, server responses or crypto errors reach a client/log.
        throw new Error('MCP unavailable. Start OWA Widget and check its MCP permissions.');
    }
}
