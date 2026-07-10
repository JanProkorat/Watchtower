import { safeStorage } from 'electron';
import { getOrchestrator } from './orchestratorHost.js';

// Azure DevOps PAT, encrypted at rest via Electron's OS-keychain-backed
// safeStorage and persisted through the orchestrator's generic settings
// store (same `settings` table other config lives in). Decrypted value is
// cached in memory for the life of the process so we don't hit safeStorage
// on every prs:refresh/prs:diff call.
const SETTINGS_KEY = 'reviews.devops.patEnc';

let cache: string | null = null;

export async function setPat(plain: string): Promise<void> {
  // safeStorage.isEncryptionAvailable() can be false very early in app
  // startup (before the OS keychain is unlocked) — call lazily, on use,
  // rather than caching a decision made at import time.
  const enc = safeStorage.encryptString(plain).toString('base64');
  await getOrchestrator().invoke('setSetting', { key: SETTINGS_KEY, value: enc });
  cache = plain;
}

export async function getPat(): Promise<string | null> {
  if (cache) return cache;
  const { value } = await getOrchestrator().invoke('getSetting', { key: SETTINGS_KEY });
  if (!value) return null;
  try {
    cache = safeStorage.decryptString(Buffer.from(value, 'base64'));
    return cache;
  } catch (err) {
    console.error('[devopsPat] failed to decrypt stored PAT:', err);
    return null;
  }
}

export async function hasPat(): Promise<boolean> {
  return (await getPat()) != null;
}
