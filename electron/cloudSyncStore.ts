// Pure, electron-free core for the Cloud Sync toggle. The hub URL is baked into
// the build (electron/hubBake.ts) — so the only persisted state is an on/off
// flag, and there is no secret at rest. Testable with the baked URL injected.

/** On-disk shape — just the toggle. */
export interface CloudSyncFile {
  enabled: boolean;
}

/** Renderer-facing status. `available` = this build has a baked hub URL. */
export interface CloudSyncStatus {
  enabled: boolean;
  available: boolean;
}

/** Save payload — just the toggle. */
export interface CloudSyncUpdate {
  enabled: boolean;
}

export function parseConfig(raw: string | null): CloudSyncFile {
  if (!raw) return { enabled: false };
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return { enabled: o.enabled === true };
  } catch {
    return { enabled: false };
  }
}

export function computeStatus(file: CloudSyncFile, bakedUrl: string | undefined): CloudSyncStatus {
  return { enabled: file.enabled, available: bakedUrl != null };
}

/** The hub URL to inject: the baked URL when enabled and a URL was baked, else null. */
export function resolveUrl(file: CloudSyncFile, bakedUrl: string | undefined): string | null {
  return file.enabled && bakedUrl ? bakedUrl : null;
}
