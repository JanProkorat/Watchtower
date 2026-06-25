type Iface = { address: string; family: string | number; internal: boolean };
type Interfaces = Record<string, Iface[] | undefined>;

const DEFAULT_WS_PORT = 7445;

/**
 * A Tailscale address is in the CGNAT range 100.64.0.0/10 (100.64.0.0–100.127.255.255).
 */
function isTailscale(addr: string): boolean {
  const m = /^(\d+)\.(\d+)\./.exec(addr);
  if (!m) return false;
  const a = Number(m[1]); const b = Number(m[2]);
  return a === 100 && b >= 64 && b <= 127;
}

/**
 * Resolve the opt-in remote bind for the WS bridge. Returns null (→ caller keeps
 * the 127.0.0.1 default) unless WATCHTOWER_WS_HOST is set. "auto" prefers a Tailscale
 * (CGNAT) address for off-LAN reach; falls back to the first non-internal IPv4 address.
 * An explicit value is used verbatim. Never binds 0.0.0.0.
 */
export function resolveWsRemoteBind(
  env: { WATCHTOWER_WS_HOST?: string; WATCHTOWER_WS_PORT?: string },
  interfaces: Interfaces,
): { host: string; port: number } | null {
  const raw = env.WATCHTOWER_WS_HOST?.trim();
  if (!raw) return null;
  const port = env.WATCHTOWER_WS_PORT ? Number(env.WATCHTOWER_WS_PORT) : DEFAULT_WS_PORT;
  if (raw !== 'auto') return { host: raw, port };
  const v4 = (i: { family: string | number; internal: boolean }) =>
    (i.family === 'IPv4' || i.family === 4) && !i.internal;
  // Pass 1: prefer a Tailscale (CGNAT) address so the server is reachable off-LAN.
  for (const list of Object.values(interfaces)) {
    for (const i of list ?? []) {
      if (v4(i as never) && isTailscale((i as { address: string }).address)) {
        return { host: (i as { address: string }).address, port };
      }
    }
  }
  // Pass 2: fall back to the first non-internal LAN IPv4.
  for (const list of Object.values(interfaces)) {
    for (const i of list ?? []) {
      if (v4(i as never)) return { host: (i as { address: string }).address, port };
    }
  }
  return null;
}

export function formatIpadConnectionInfo(opts: { host: string; port: number; token: string }): string {
  return `[orchestrator] iPad connect → ws://${opts.host}:${opts.port}/ws  token: ${opts.token}`;
}
