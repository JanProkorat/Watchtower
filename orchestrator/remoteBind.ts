type Iface = { address: string; family: string | number; internal: boolean };
type Interfaces = Record<string, Iface[] | undefined>;

const DEFAULT_WS_PORT = 7445;

/**
 * Resolve the opt-in remote bind for the WS bridge. Returns null (→ caller keeps
 * the 127.0.0.1 default) unless WATCHTOWER_WS_HOST is set. "auto" picks the first
 * non-internal IPv4 address; an explicit value is used verbatim. Never binds 0.0.0.0.
 */
export function resolveWsRemoteBind(
  env: { WATCHTOWER_WS_HOST?: string; WATCHTOWER_WS_PORT?: string },
  interfaces: Interfaces,
): { host: string; port: number } | null {
  const raw = env.WATCHTOWER_WS_HOST?.trim();
  if (!raw) return null;
  const port = env.WATCHTOWER_WS_PORT ? Number(env.WATCHTOWER_WS_PORT) : DEFAULT_WS_PORT;
  if (raw !== 'auto') return { host: raw, port };
  for (const list of Object.values(interfaces)) {
    for (const i of list ?? []) {
      const fam = i.family === 'IPv4' || i.family === 4;
      if (fam && !i.internal) return { host: i.address, port };
    }
  }
  return null;
}

export function formatIpadConnectionInfo(opts: { host: string; port: number; token: string }): string {
  return `[orchestrator] iPad connect → ws://${opts.host}:${opts.port}/ws  token: ${opts.token}`;
}
