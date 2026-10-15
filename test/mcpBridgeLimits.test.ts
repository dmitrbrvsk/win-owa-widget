import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { createConnection } from 'node:net';
import { afterEach, expect, it } from 'vitest';

import { type ReadBridge, startReadBridge } from '../src/main/mcp/bridge';
import { BRIDGE_PATH, REQUEST_CONTEXT, seal } from '../src/mcp/wire';

const bridges: ReadBridge[] = [];
afterEach(() => {
    for (const bridge of bridges.splice(0)) bridge.close();
});
async function setup() {
    let calls = 0;
    const bridge = await startReadBridge(() => {
        calls += 1;
        return { ok: true };
    });
    bridges.push(bridge);
    const body = () =>
        seal(
            { id: randomUUID(), tool: 'get_status', args: {} },
            bridge.connection.key,
            REQUEST_CONTEXT,
        );
    return { bridge, body, calls: () => calls };
}
function post(port: number, body: string) {
    return new Promise<number>((resolve, reject) => {
        const req = request(
            {
                hostname: '127.0.0.1',
                port,
                path: BRIDGE_PATH,
                method: 'POST',
                agent: false,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                },
            },
            (res) => {
                res.resume();
                res.on('end', () => resolve(res.statusCode!));
            },
        );
        req.on('error', reject);
        req.end(body);
    });
}

it('does not spend the authorized operation budget on 120 unauthenticated envelopes', async () => {
    const { bridge, body, calls } = await setup();
    for (let i = 0; i < 120; i++) {
        // eslint-disable-next-line no-await-in-loop -- Sequential probes measure the shared rate budget without triggering the independent concurrency cap.
        expect(await post(bridge.connection.port, '{}')).toBe(400);
    }
    expect(calls()).toBe(0);
    expect(await post(bridge.connection.port, body())).toBe(200);
    expect(calls()).toBe(1);
});

it('still refuses the 121st authenticated operation in one minute', async () => {
    const { bridge, body, calls } = await setup();
    for (let i = 0; i < 120; i++) {
        // eslint-disable-next-line no-await-in-loop -- Unique authenticated requests must exhaust the operation budget rather than the replay or concurrency guards.
        expect(await post(bridge.connection.port, body())).toBe(200);
    }
    expect(await post(bridge.connection.port, body())).toBe(429);
    expect(calls()).toBe(120);
});

function drip(port: number, mode: 'headers' | 'body'): Promise<number> {
    return new Promise((resolve, reject) => {
        const socket = createConnection({ host: '127.0.0.1', port });
        let connected = false;
        let started = 0;
        let interval: ReturnType<typeof setInterval> | undefined;
        const failSafe = setTimeout(() => {
            socket.destroy();
            reject(new Error('Bridge deadline did not close the socket'));
        }, 4500);
        socket.on('data', () => {});
        socket.on('error', (error) => {
            if (!connected) reject(error);
        });
        socket.once('connect', () => {
            connected = true;
            started = performance.now();
            const prefix = `POST ${BRIDGE_PATH} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n`;
            socket.write(
                mode === 'headers'
                    ? `${prefix}X-Drip: `
                    : `${prefix}Content-Type: application/json\r\nContent-Length: 10000\r\n\r\n`,
            );
            // Continuous activity must not extend the absolute connection deadline.
            interval = setInterval(() => socket.write('x'), 100);
        });
        socket.once('close', () => {
            clearTimeout(failSafe);
            clearInterval(interval);
            if (connected) resolve(performance.now() - started);
        });
    });
}

it('closes slow header and body drips within the absolute three-second deadline', async () => {
    const { bridge, calls } = await setup();
    const elapsed = await Promise.all([
        drip(bridge.connection.port, 'headers'),
        drip(bridge.connection.port, 'body'),
    ]);
    for (const milliseconds of elapsed) {
        expect(milliseconds).toBeGreaterThanOrEqual(2500);
        expect(milliseconds).toBeLessThan(4200);
    }
    expect(calls()).toBe(0);
}, 6000);
