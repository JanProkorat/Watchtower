import type { ConnStore } from '../connection.js';

// macOS Screen Sharing offers Apple authentication (RFB security type 30) ahead
// of the standalone VNC password (type 2), and noVNC selects the first supported
// type — so it uses Apple auth, which needs the macOS *account* username +
// password. These are kept in their own Preferences key (separate from the
// Watchtower connection) and owned entirely by the Remote Mac module.

export type VncCreds = { username: string; password: string };

const KEY = 'watchtower.vnc.creds';

export async function saveVncCreds(store: ConnStore, c: VncCreds): Promise<void> {
  await store.set(KEY, JSON.stringify(c));
}

export async function loadVncCreds(store: ConnStore): Promise<VncCreds | null> {
  const raw = await store.get(KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as VncCreds;
    if (typeof v?.username === 'string' && typeof v?.password === 'string') return v;
    return null;
  } catch {
    return null;
  }
}
