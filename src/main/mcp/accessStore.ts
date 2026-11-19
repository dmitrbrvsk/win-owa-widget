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

    loadScopes(sources: ReadonlyMap<string, string>): Map<string, McpAccess> {
        try {
            const raw = readPrivateJson(this.accessFile, 256 * 1024);
            if (!isRecord(raw)) return new Map();
            if (raw.format === 1) {
                const match = [...sources].find(([, legacy]) => legacy === raw.account);
                const access = match && parseMcpAccess(raw.access);
                const migrated =
                    match && access?.enabled ? new Map([[match[0], access]]) : new Map();
                this.saveScopes(migrated);
                return migrated;
            }
            if (raw.format !== 2 || !isRecord(raw.scopes)) return new Map();
            const scopes = new Map<string, McpAccess>();
            for (const key of sources.keys()) {
                if (!Object.hasOwn(raw.scopes, key)) continue;
                const access = parseMcpAccess(raw.scopes[key]);
                if (access.enabled) scopes.set(key, access);
            }
            if (Object.keys(raw.scopes).length !== scopes.size) this.saveScopes(scopes);
            return scopes;
        } catch {
            return new Map();
        }
    }

    saveScopes(scopes: ReadonlyMap<string, McpAccess>): void {
        rmSync(this.accessFile, { force: true });
        if (scopes.size)
            writePrivateJson(this.accessFile, { format: 2, scopes: Object.fromEntries(scopes) });
    }

    removeConnection(): void {
        rmSync(this.connectionFile, { force: true });
    }
}
