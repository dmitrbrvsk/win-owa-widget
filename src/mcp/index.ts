import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import path from 'node:path';

import { createMcpServer } from './server';

declare const MCP_BUILD_VERSION: string;

const reportError = () => {
    process.stderr.write(
        'OWA Widget MCP unavailable. Check Node version and local configuration.\n',
    );
};

function start(): void {
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major !== 24 || minor < 22 || process.versions.node.includes('-'))
        throw new Error('Unsupported Node runtime');
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--connection-file' || !path.isAbsolute(args[1]))
        throw new Error('Invalid configuration');
    const connectionFile = args[1];
    const handle = serveStdio(() => createMcpServer(connectionFile, MCP_BUILD_VERSION), {
        transport: new StdioServerTransport(process.stdin, process.stdout, {
            maxBufferSize: 64 * 1024,
        }),
        onerror: reportError,
    });
    const close = () => {
        void handle.close().catch(reportError);
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
}

try {
    start();
} catch {
    reportError();
    process.exitCode = 1;
}
