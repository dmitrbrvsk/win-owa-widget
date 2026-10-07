// The stored password is sealed together with the server it was typed for, and is handed out for
// that server only. Without this, anything that could change the server address (a compromised
// settings page, an edited settings.json) would make the app log in to a server of its choice with
// the saved password. Pure functions: the encryption itself (DPAPI) lives in the main process.

interface Sealed {
  v: 1;
  host: string;
  password: string;
}

export function sealSecret(password: string, serverKey: string): string {
  const sealed: Sealed = { v: 1, host: serverKey.toLowerCase(), password };
  return JSON.stringify(sealed);
}

export type OpenedSecret =
  /** Sealed for this server. */
  | { kind: 'ok'; password: string }
  /** Sealed for another server: not handed out. */
  | { kind: 'other-server' }
  /** Stored by a version before 0.2.0 (the bare password): the caller binds it to the configured server. */
  | { kind: 'legacy'; password: string };

export function openSecret(plain: string, serverKey: string): OpenedSecret {
  try {
    const v = JSON.parse(plain) as Partial<Sealed> | null;
    if (v && typeof v === 'object' && v.v === 1 && typeof v.host === 'string' && typeof v.password === 'string') {
      return v.host === serverKey.toLowerCase() && serverKey ? { kind: 'ok', password: v.password } : { kind: 'other-server' };
    }
  } catch {
    /* not JSON: a bare password */
  }
  return { kind: 'legacy', password: plain };
}
