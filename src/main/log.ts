// A small append-only diagnostic log in the user's profile, so a failed login or a blank window
// can be understood after the fact. It never records passwords, cookies, canaries, headers or
// response bodies: only URLs, HTTP statuses, error kinds and window events.
import { app } from 'electron';
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 1_000_000;
let file: string | undefined;

export function logPath(): string {
  if (!file) {
    const dir = app.getPath('logs');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    file = join(dir, 'owa-widget.log');
  }
  return file;
}

function rotate(path: string) {
  try {
    if (existsSync(path) && statSync(path).size > MAX_BYTES) {
      const old = `${path}.1`;
      rmSync(old, { force: true });
      renameSync(path, old);
    }
  } catch {
    /* logging must never break the app */
  }
}

function write(level: 'info' | 'warn' | 'error', message: string) {
  const line = `${new Date().toISOString()} ${level.padEnd(5)} ${message}\n`;
  try {
    const path = logPath();
    rotate(path);
    appendFileSync(path, line, { mode: 0o600 });
  } catch {
    /* ignore */
  }
  if (!app.isPackaged) (level === 'error' ? console.error : console.log)(line.trimEnd());
}

export const log = {
  info: (m: string) => write('info', m),
  warn: (m: string) => write('warn', m),
  error: (m: string) => write('error', m),
};

/** Strips query strings and userinfo, so a logged URL cannot carry a token or a password. */
export function safeUrlForLog(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '<invalid url>';
  }
}

export function describeError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}
