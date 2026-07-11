import { safeStorage } from 'electron';
import { getOrchestrator } from './orchestratorHost.js';

// Azure DevOps PATs, encrypted at rest via Electron's OS-keychain-backed
// safeStorage and persisted through the orchestrator's generic settings
// store (same `settings` table other config lives in), keyed by DevOps
// host — one PAT per server, since a server can host multiple projects.
// Decrypted values are cached in memory for the life of the process so we
// don't hit safeStorage on every prs:refresh/prs:diff call.
const SETTINGS_KEY = 'reviews.devops.pats';

let cache: Record<string, string> | null = null; // host -> plaintext

async function readMap(): Promise<Record<string, string>> { // host -> base64enc
  const { value } = await getOrchestrator().invoke('getSetting', { key: SETTINGS_KEY });
  if (!value) return {};
  try { return JSON.parse(value) as Record<string, string>; } catch { return {}; }
}

export async function setPat(host: string, plain: string): Promise<void> {
  // safeStorage.isEncryptionAvailable() can be false very early in app
  // startup (before the OS keychain is unlocked) — call lazily, on use,
  // rather than caching a decision made at import time.
  const map = await readMap();
  map[host] = safeStorage.encryptString(plain).toString('base64');
  await getOrchestrator().invoke('setSetting', { key: SETTINGS_KEY, value: JSON.stringify(map) });
  cache = { ...(cache ?? {}), [host]: plain };
}

export async function getPats(): Promise<Record<string, string>> {
  if (cache) return cache;
  const map = await readMap();
  const out: Record<string, string> = {};
  for (const [host, enc] of Object.entries(map)) {
    try { out[host] = safeStorage.decryptString(Buffer.from(enc, 'base64')); }
    catch (err) { console.error('[devopsPat] decrypt failed for', host, err); }
  }
  cache = out;
  return out;
}

export async function hasPat(host: string): Promise<boolean> {
  return (await getPats())[host] != null;
}
