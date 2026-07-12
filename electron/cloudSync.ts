import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BAKED_PG_URL } from './hubBake.js';
import {
  parseConfig, computeStatus, resolveUrl,
  type CloudSyncFile, type CloudSyncStatus, type CloudSyncUpdate,
} from './cloudSyncStore.js';

// The on/off flag lives in a main-owned file (not data.db) so main can read it
// BEFORE the orchestrator — which owns data.db — starts. The hub URL itself is
// baked into the build (./hubBake.ts), so nothing secret is persisted here.
function filePath(): string {
  return path.join(app.getPath('userData'), 'cloud-sync.json');
}

function load(): CloudSyncFile {
  const p = filePath();
  let raw: string | null = null;
  try {
    if (existsSync(p)) raw = readFileSync(p, 'utf8');
  } catch (err) {
    console.warn('[cloudSync] failed to read', p, err);
  }
  return parseConfig(raw);
}

/** Renderer-facing status: the toggle + whether this build has a baked hub URL. */
export function getCloudSyncConfig(): CloudSyncStatus {
  return computeStatus(load(), BAKED_PG_URL);
}

/** Persist the on/off flag. */
export function setCloudSyncConfig(next: CloudSyncUpdate): void {
  writeFileSync(filePath(), JSON.stringify({ enabled: next.enabled }), 'utf8');
}

/** Startup: the baked hub URL to inject into the orchestrator env, or null. */
export function resolveCloudSyncUrl(): string | null {
  const file = load();
  const url = resolveUrl(file, BAKED_PG_URL);
  if (file.enabled && !url) {
    console.warn('[cloudSync] enabled but this build has no baked hub URL; sync stays dormant.');
  }
  return url;
}
