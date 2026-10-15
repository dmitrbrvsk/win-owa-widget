import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import nodePath from 'node:path';

import { readPrivateJson, writePrivateJson } from '../../mcp/privateFiles';
import { isRecord } from '../../mcp/wire';
import { type McpAccess, parseMcpAccess } from '../../shared/mcp';

export const NO_MCP_ACCESS: McpAccess = { enabled: false, allowTitles: false };

export function accountBinding(account: string, demo: boolean): string {
    return createHash('sha256')
        .update(JSON.stringify([account, demo]))
        .digest('hex');
}

/** Permissions deliberately live outside AppSettings: renderer settings patches cannot grant access. */
export class McpAccessStore {
    readonly connectionFile: string;
    private readonly accessFile: string;

    constructor(directory: string) {
        this.connectionFile = nodePath.join(directory, 'connection.json');
        this.accessFile = nodePath.join(directory, 'access.json');
    }

    load(account: string): McpAccess {
        try {
            const raw = readPrivateJson(this.accessFile);
            if (!isRecord(raw) || raw.format !== 1 || raw.account !== account)
                return { ...NO_MCP_ACCESS };
            return parseMcpAccess(raw.access);
        } catch {
            return { ...NO_MCP_ACCESS };
        }
    }

    save(account: string, access: McpAccess): void {
        // A failed downgrade must not leave a previous broader grant to restore on restart.
        // Losing this record during a crash is safe: initialize defaults to disabled.
        rmSync(this.accessFile, { force: true });
        writePrivateJson(this.accessFile, { format: 1, account, access });
    }

    removeConnection(): void {
        rmSync(this.connectionFile, { force: true });
    }
}
