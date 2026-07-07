import { parseMac } from './lib/wakeOnLan.js';

export type Connection = {
  host: string; port: number; token: string;
  mac?: string;        // Mac's Ethernet MAC, for Wake-on-LAN
  lanIp?: string;      // home wake target (the Mac's LAN IP)
  wanHost?: string;    // away wake target (DDNS hostname / public IP)
  wanPort?: number;    // away wake target port (default 9)
};
export type ConnStore = { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void> };

const KEY = 'watchtower.connection';

export function parseConnection(input: {
  host: string; port: string; token: string;
  mac?: string; lanIp?: string; wanHost?: string; wanPort?: string;
}):
  | { ok: true; value: Connection }
  | { ok: false; error: string } {
  const host = input.host.trim();
  if (!host) return { ok: false, error: 'Host is required' };
  const port = Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'Port must be 1–65535' };
  const token = input.token.trim();
  if (!token) return { ok: false, error: 'Token is required' };

  const value: Connection = { host, port, token };

  const mac = input.mac?.trim();
  if (mac) {
    if (!parseMac(mac)) return { ok: false, error: 'MAC adresa je neplatná' };
    value.mac = mac;
  }
  const lanIp = input.lanIp?.trim();
  if (lanIp) value.lanIp = lanIp;
  const wanHost = input.wanHost?.trim();
  if (wanHost) {
    value.wanHost = wanHost;
    const rawPort = input.wanPort?.trim();
    if (rawPort) {
      const wp = Number(rawPort);
      if (!Number.isInteger(wp) || wp < 1 || wp > 65535) return { ok: false, error: 'Wake port must be 1–65535' };
      value.wanPort = wp;
    } else {
      value.wanPort = 9;
    }
  }
  return { ok: true, value };
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
