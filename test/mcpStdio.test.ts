import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { PassThrough } from 'node:stream';
import { expect, it, vi } from 'vitest';

import { type BridgeCall, createMcpServer } from '../src/mcp/server';
import { MCP_TOOL_NAMES } from '../src/shared/mcp';

async function connect(bridge: BridgeCall) {
    const input = new PassThrough();
    const output = new PassThrough();
    const handle = serveStdio(() => createMcpServer('/private/connection.json', 'test', bridge), {
        transport: new StdioServerTransport(input, output, { maxBufferSize: 64 * 1024 }),
    });
    let sequence = 0;
    const exchange = async (method: string, params: Record<string, unknown>) => {
        sequence += 1;
        const id = sequence;
        const response = new Promise<Record<string, unknown>>((resolve) => {
            let buffered = '';
            const consume = (chunk: Buffer) => {
                buffered += chunk.toString('utf8');
                const lines = buffered.split('\n');
                buffered = lines.pop() ?? '';
                for (const line of lines) {
                    const message = JSON.parse(line) as Record<string, unknown>;
                    if (message.id === id) {
                        output.off('data', consume);
                        resolve(message);
                    }
                }
            };
            output.on('data', consume);
        });
        input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        return response;
    };
    await exchange('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' },
    });
    input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    return { exchange, close: () => handle.close() };
}

it('advertises only four read-only tools with strict input schemas over real SDK stdio', async () => {
    const bridge = vi.fn<BridgeCall>().mockResolvedValue({ metadata: { demo: true } });
    const session = await connect(bridge);
    try {
        const listed = await session.exchange('tools/list', {});
        const result = listed.result as {
            tools: Array<{
                name: string;
                annotations: { readOnlyHint: boolean; destructiveHint: boolean };
                inputSchema: { additionalProperties: boolean };
            }>;
        };
        expect(result.tools.map((tool) => tool.name)).toEqual([...MCP_TOOL_NAMES]);
        for (const tool of result.tools) {
            expect(tool.annotations.readOnlyHint).toBe(true);
            expect(tool.annotations.destructiveHint).toBe(false);
            expect(tool.inputSchema.additionalProperties).toBe(false);
        }
        const called = await session.exchange('tools/call', { name: 'get_status', arguments: {} });
        expect(called.result).toMatchObject({ structuredContent: { metadata: { demo: true } } });
        expect(bridge).toHaveBeenCalledExactlyOnceWith(
            '/private/connection.json',
            'get_status',
            {},
        );
    } finally {
        await session.close();
    }
});

it('rejects unknown operations, extra fields, invalid dates and excessive limits before bridge access', async () => {
    const bridge = vi.fn<BridgeCall>();
    const session = await connect(bridge);
    try {
        const invalid = [
            { name: 'delete_meeting', arguments: {} },
            { name: 'get_status', arguments: { password: 'fixture' } },
            {
                name: 'list_meetings',
                arguments: { start: '2026-10-16', end: '2026-10-17T00:00:00Z' },
            },
            {
                name: 'list_meetings',
                arguments: {
                    start: '2026-10-16T00:00:00Z',
                    end: '2026-10-17T00:00:00Z',
                    limit: 101,
                },
            },
            {
                name: 'search_meetings',
                arguments: {
                    start: '2026-10-16T00:00:00Z',
                    end: '2026-10-17T00:00:00Z',
                    query: ' ',
                },
            },
        ];
        for (const args of invalid) {
            // eslint-disable-next-line no-await-in-loop -- Each exchange has a single response listener; these protocol probes intentionally run in order.
            const response = await session.exchange('tools/call', args);
            expect(response.error ?? response.result).toBeDefined();
            expect(JSON.stringify(response)).toMatch(/error|isError/);
        }
        expect(bridge).not.toHaveBeenCalled();
    } finally {
        await session.close();
    }
});

it('redacts arbitrary bridge errors instead of exposing local secrets to the MCP client', async () => {
    const bridge = vi.fn<BridgeCall>().mockRejectedValue(new Error('secret query /private/token'));
    const session = await connect(bridge);
    try {
        const response = await session.exchange('tools/call', {
            name: 'get_status',
            arguments: {},
        });
        expect(response.result).toEqual({
            isError: true,
            content: [{ type: 'text', text: 'OWA Widget MCP request unavailable.' }],
        });
        expect(JSON.stringify(response)).not.toMatch(/secret|private|token/);
    } finally {
        await session.close();
    }
});
