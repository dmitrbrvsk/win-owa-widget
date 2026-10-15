import { randomUUID } from 'node:crypto';
import {
    chmodSync,
    closeSync,
    constants,
    fstatSync,
    lstatSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import nodePath from 'node:path';

import { type BridgeConnection, parseConnection } from './wire';

function assertPrivate(path: string, directory: boolean) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()))
        throw new Error('Invalid MCP file');
    if (
        process.platform !== 'win32' &&
        (stat.mode % 0o100 !== 0 || stat.uid !== process.getuid?.())
    )
        throw new Error('MCP files must be private');
}

/** Windows inherits the user's profile ACL; POSIX additionally enforces owner-only mode/ownership. */
export function privateDirectory(path: string): void {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    if (lstatSync(path).isSymbolicLink()) throw new Error('Invalid MCP directory');
    if (process.platform !== 'win32') chmodSync(path, 0o700);
    assertPrivate(path, true);
}

export function readPrivateJson(path: string): unknown {
    if (!nodePath.isAbsolute(path)) throw new Error('MCP file path must be absolute');
    assertPrivate(nodePath.dirname(path), true);
    assertPrivate(path, false);
    // eslint-disable-next-line no-bitwise -- Node filesystem flags are a bitmask; NOFOLLOW rejects symlinks.
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > 4096 || stat.nlink !== 1)
            throw new Error('Invalid MCP file');
        if (
            process.platform !== 'win32' &&
            (stat.mode % 0o100 !== 0 || stat.uid !== process.getuid?.())
        )
            throw new Error('MCP files must be private');
        return JSON.parse(readFileSync(fd, 'utf8')) as unknown;
    } finally {
        closeSync(fd);
    }
}

export function writePrivateJson(path: string, value: unknown): void {
    privateDirectory(nodePath.dirname(path));
    const temp = nodePath.join(nodePath.dirname(path), `.mcp-${randomUUID()}.tmp`);
    try {
        writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
        renameSync(temp, path);
    } finally {
        rmSync(temp, { force: true });
    }
}

export function readConnection(path: string): BridgeConnection {
    return parseConnection(readPrivateJson(path));
}
