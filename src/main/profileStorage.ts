// Shared profile I/O and OS encryption. Callers own each file's schema and recovery policy.
import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';

export function profileDir(): string {
    const path = app.getPath('userData');
    if (!existsSync(path)) mkdirSync(path, { recursive: true });
    return path;
}

export function writeAtomic(path: string, data: string | Buffer) {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, data, { mode: 0o600 });
    renameSync(tmp, path);
}

export function readBounded(path: string, maxBytes: number): Buffer {
    const size = statSync(path);
    if (!size.isFile() || size.size > maxBytes) throw new Error('Invalid profile file');
    return readFileSync(path);
}

// Installed builds target Windows DPAPI. Only unpackaged Linux development permits this backend.
if (process.platform === 'linux' && !app.isPackaged) safeStorage.setUsePlainTextEncryption(true);

export function encrypt(text: string): Buffer | null {
    return safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : null;
}

export function decrypt(buf: Buffer): string | null {
    try {
        return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : null;
    } catch {
        return null;
    }
}
