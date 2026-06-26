import { parseMac, magicPacketBase64 } from '../lib/wakeOnLan.js';

export interface WakeTarget { host: string; port: number }

export interface WakeDeps {
  send(payloadBase64: string, host: string, port: number): Promise<void>;
}

export interface WakeRequest { mac: string; targets: WakeTarget[] }

export type WakeResult = { ok: true; sent: number } | { ok: false; error: string };

/** LAN target at the fixed WoL port 9; DDNS target at wanPort (default 9). */
export function wakeTargets(cfg: { lanIp?: string; wanHost?: string; wanPort?: number }): WakeTarget[] {
  const targets: WakeTarget[] = [];
  if (cfg.lanIp) targets.push({ host: cfg.lanIp, port: 9 });
  if (cfg.wanHost) targets.push({ host: cfg.wanHost, port: cfg.wanPort ?? 9 });
  return targets;
}

/**
 * Build the packet once, fire it at every target. Per-target failures are
 * swallowed (the off-network target always fails); success = at least one send.
 */
export async function performWake(deps: WakeDeps, req: WakeRequest): Promise<WakeResult> {
  const mac = parseMac(req.mac);
  if (!mac) return { ok: false, error: 'MAC adresa je neplatná' };
  if (req.targets.length === 0) return { ok: false, error: 'Není nastaven žádný cíl' };
  const payload = magicPacketBase64(mac);
  let sent = 0;
  for (const t of req.targets) {
    try { await deps.send(payload, t.host, t.port); sent++; } catch { /* ignore per-target */ }
  }
  return sent > 0 ? { ok: true, sent } : { ok: false, error: 'Nepodařilo se odeslat paket' };
}
