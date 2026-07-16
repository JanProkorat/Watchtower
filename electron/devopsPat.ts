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
// Hosts whose stored blob is present but failed to decrypt. This happens after
// the unsigned app is rebuilt: the new ad-hoc code signature loses Keychain
// access to the key that encrypted the PAT, so decryptString throws. We track
// it so the UI can say "re-enter" instead of the misleading "PAT not set".
let unreadable: Set<string> = new Set();

// Injectable crypto seam so classifyPats() is testable without the electron
// runtime (safeStorage is main-process-only and undefined under vitest).
export interface PatCrypto {
  isEncryptionAvailable(): boolean;
  decrypt(enc: Buffer): string;
}

export interface ClassifiedPats {
  pats: Record<string, string>; // host -> plaintext (successfully decrypted)
  unreadable: string[]; // hosts with a stored blob that could not be decrypted
}

/**
 * Decrypt a stored host->ciphertext map, separating readable PATs from ones
 * that are present but undecryptable. A blob is only "unreadable" when
 * encryption is actually available — a `false` isEncryptionAvailable() during
 * early startup (before the OS keychain is unlocked) is transient, not a
 * corrupt blob, so we don't flag it and let a later call re-classify.
 */
export function classifyPats(map: Record<string, string>, crypto: PatCrypto): ClassifiedPats {
  const pats: Record<string, string> = {};
  const bad: string[] = [];
  const available = crypto.isEncryptionAvailable();
  for (const [host, enc] of Object.entries(map)) {
    try {
      pats[host] = crypto.decrypt(Buffer.from(enc, 'base64'));
    } catch (err) {
      if (available) bad.push(host);
      console.error('[devopsPat] decrypt failed for', host, err);
    }
  }
  return { pats, unreadable: bad };
}

const safeStorageCrypto: PatCrypto = {
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  decrypt: (enc) => safeStorage.decryptString(enc),
};

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
  // Re-entering a PAT self-heals a previously-unreadable host: the fresh blob
  // is encrypted under the current binary's keychain key.
  unreadable.delete(host);
}

export async function getPats(): Promise<Record<string, string>> {
  if (cache) return cache;
  const { pats, unreadable: bad } = classifyPats(await readMap(), safeStorageCrypto);
  cache = pats;
  unreadable = new Set(bad);
  return pats;
}

export type PatStatus = 'none' | 'saved' | 'unreadable';

/**
 * Three-way status for the Reviews PAT field: 'saved' (decrypts), 'unreadable'
 * (stored but the keychain key rotated — re-enter), or 'none' (never set).
 */
export async function patStatus(host: string): Promise<PatStatus> {
  const pats = await getPats(); // populates `unreadable` as a side effect
  if (pats[host] != null) return 'saved';
  return unreadable.has(host) ? 'unreadable' : 'none';
}
