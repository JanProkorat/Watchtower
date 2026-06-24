export type Connection = { host: string; port: number; token: string };
export type ConnStore = { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void> };

const KEY = 'watchtower.connection';

export function parseConnection(input: { host: string; port: string; token: string }):
  | { ok: true; value: Connection }
  | { ok: false; error: string } {
  const host = input.host.trim();
  if (!host) return { ok: false, error: 'Host is required' };
  const port = Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'Port must be 1–65535' };
  const token = input.token.trim();
  if (!token) return { ok: false, error: 'Token is required' };
  return { ok: true, value: { host, port, token } };
}

export function connectionToWsUrl(c: Connection): string {
  return `ws://${c.host}:${c.port}/ws`;
}

export async function saveConnection(store: ConnStore, c: Connection): Promise<void> {
  await store.set(KEY, JSON.stringify(c));
}

export async function loadConnection(store: ConnStore): Promise<Connection | null> {
  const raw = await store.get(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Connection;
  } catch {
    return null;
  }
}
