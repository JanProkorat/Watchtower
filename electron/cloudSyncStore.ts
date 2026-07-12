// Pure, electron-free core for the Cloud Sync setting — all encrypt/decrypt/
// parse logic, with safeStorage injected so it is unit-testable. The electron
// binding lives in ./cloudSync.ts.

/** The subset of Electron `safeStorage` we use — injected so the core is testable. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(enc: Buffer): string;
}

/** On-disk shape. `url` is base64 safeStorage ciphertext (never plaintext). */
export interface CloudSyncFile {
  enabled: boolean;
  url?: string;
}

/** What the renderer is allowed to see — never the URL itself. */
export interface CloudSyncStatus {
  enabled: boolean;
  configured: boolean;
}

/** Save payload. `url === undefined` = toggle-only (keep secret); `''`/null clears. */
export interface CloudSyncUpdate {
  enabled: boolean;
  url?: string | null;
}

export function parseConfig(raw: string | null): CloudSyncFile {
  if (!raw) return { enabled: false };
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const enabled = o.enabled === true;
    const url = typeof o.url === 'string' && o.url.length > 0 ? o.url : undefined;
    return url ? { enabled, url } : { enabled };
  } catch {
    return { enabled: false };
  }
}

export function computeStatus(file: CloudSyncFile): CloudSyncStatus {
  return { enabled: file.enabled, configured: file.url != null };
}

export function computeUpdate(
  prev: CloudSyncFile,
  next: CloudSyncUpdate,
  ss: SafeStorageLike,
): CloudSyncFile {
  let url = prev.url;
  if (next.url !== undefined) {
    if (!next.url) {
      url = undefined; // '' or null clears the saved secret
    } else {
      if (!ss.isEncryptionAvailable()) {
        throw new Error('Secure storage is unavailable; cannot save the connection string.');
      }
      url = ss.encryptString(next.url).toString('base64');
    }
  }
  return url ? { enabled: next.enabled, url } : { enabled: next.enabled };
}

export function resolveUrl(file: CloudSyncFile, ss: SafeStorageLike): string | null {
  if (!file.enabled || !file.url) return null;
  if (!ss.isEncryptionAvailable()) return null;
  try {
    return ss.decryptString(Buffer.from(file.url, 'base64'));
  } catch {
    return null;
  }
}
