import { safeStorage, app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  parseConfig, computeStatus, computeUpdate, resolveUrl,
  type CloudSyncFile, type CloudSyncStatus, type CloudSyncUpdate,
} from './cloudSyncStore.js';

// The encrypted hub setting lives in a main-owned file (not data.db) so main
// can read it BEFORE the orchestrator — which owns data.db — starts.
function filePath(): string {
  return path.join(app.getPath('userData'), 'cloud-sync.json');
}

function load(): CloudSyncFile {
  const p = filePath();
  return parseConfig(existsSync(p) ? readFileSync(p, 'utf8') : null);
}

/** Renderer-facing status (enabled + whether a secret is stored). Never the URL. */
export function getCloudSyncConfig(): CloudSyncStatus {
  return computeStatus(load());
}

/** Persist an enable/URL change. Throws if encryption is unavailable. */
export function setCloudSyncConfig(next: CloudSyncUpdate): void {
  const merged = computeUpdate(load(), next, safeStorage);
  writeFileSync(filePath(), JSON.stringify(merged), 'utf8');
}

/** Startup: the decrypted URL to inject into the orchestrator env, or null. */
export function resolveCloudSyncUrl(): string | null {
  return resolveUrl(load(), safeStorage);
}
