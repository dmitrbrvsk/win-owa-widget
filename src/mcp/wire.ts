// The internal loopback bridge is not an HTTP MCP endpoint. MCP itself uses the SDK's stdio transport.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const REQUEST_CONTEXT = 'OWA-MCP-REQUEST-v1';
export const RESPONSE_CONTEXT = 'OWA-MCP-RESPONSE-v1:';
export const MAX_REQUEST_BYTES = 16 * 1024;
export const MAX_RESPONSE_BYTES = 192 * 1024;
export const BRIDGE_PATH = '/mcp-read-v1';
export interface BridgeConnection {
    format: 1;
    port: number;
    key: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function decode(value: unknown, length?: number): Buffer {
    if (typeof value !== 'string' || !/^[\w-]+$/.test(value))
        throw new Error('Invalid bridge encoding');
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value || (length !== undefined && bytes.length !== length))
        throw new Error('Invalid bridge encoding');
    return bytes;
}

export function parseConnection(raw: unknown): BridgeConnection {
    if (
        !isRecord(raw) ||
        raw.format !== 1 ||
        typeof raw.port !== 'number' ||
        !Number.isInteger(raw.port) ||
        raw.port < 1 ||
        raw.port > 65_535 ||
        typeof raw.key !== 'string' ||
        Object.keys(raw).some((k) => !['format', 'port', 'key'].includes(k))
    )
        throw new Error('Invalid bridge connection');
    decode(raw.key, 32);
    return { format: 1, port: raw.port, key: raw.key };
}

/** Fresh random nonces and separate request/response AAD prevent replaying a request as a response. */
export function seal(value: unknown, key: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', decode(key, 32), iv);
    cipher.setAAD(Buffer.from(context));
    const payload = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return JSON.stringify({
        v: 1,
        iv: iv.toString('base64url'),
        tag: cipher.getAuthTag().toString('base64url'),
        payload: payload.toString('base64url'),
    });
}

export function unseal(body: string, key: string, context: string): unknown {
    const raw: unknown = JSON.parse(body);
    if (!isRecord(raw) || raw.v !== 1 || Object.keys(raw).length !== 4)
        throw new Error('Invalid bridge envelope');
    const decipher = createDecipheriv('aes-256-gcm', decode(key, 32), decode(raw.iv, 12));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(decode(raw.tag, 16));
    const clear = Buffer.concat([decipher.update(decode(raw.payload)), decipher.final()]);
    return JSON.parse(clear.toString('utf8')) as unknown;
}
