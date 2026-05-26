// Reads & decrypts cookies from Chromium-based browsers (Brave, Chrome) on
// macOS. Only ever queries rows whose host_key matches the caller-supplied
// domain — we never look at, decrypt, or log the user's other cookies.
//
// Encryption format (Chromium on macOS):
//   - encrypted_value is prefixed with "v10" (3 bytes)
//   - then AES-128-CBC ciphertext
//   - key = PBKDF2(password=<browser>SafeStorage from Keychain,
//                  salt="saltysalt", iterations=1003, keylen=16, sha1)
//   - IV  = 16 bytes of ASCII space (0x20)
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

interface BrowserSpec {
  name: string;
  appPath: string;          // .app bundle for `open -a`
  cookiesPath: string;      // SQLite Cookies file
  keychainEntry: string;    // service name in macOS Keychain
}

const HOME = homedir();

const BROWSERS: BrowserSpec[] = [
  {
    name: 'Brave',
    appPath: '/Applications/Brave Browser.app',
    cookiesPath: join(HOME, 'Library/Application Support/BraveSoftware/Brave-Browser/Default/Cookies'),
    keychainEntry: 'Brave Safe Storage',
  },
  {
    name: 'Chrome',
    appPath: '/Applications/Google Chrome.app',
    cookiesPath: join(HOME, 'Library/Application Support/Google/Chrome/Default/Cookies'),
    keychainEntry: 'Chrome Safe Storage',
  },
];

interface CookieRow {
  host_key: string;
  name: string;
  /** Plaintext value (rare — only set for non-secure cookies). */
  value: string;
  /** Encrypted v10 blob (Buffer from better-sqlite3, Uint8Array-compatible). */
  encrypted_value: Buffer;
}

interface CookiePair {
  name: string;
  value: string;
}

function readSafeStorageKey(entry: string): string | null {
  const r = spawnSync(
    'security',
    ['find-generic-password', '-s', entry, '-w'],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) return null;
  return r.stdout.trim();
}

function deriveAesKey(password: string): Buffer {
  return crypto.pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
}

function decryptV10(blob: Buffer, key: Buffer): string | null {
  if (blob.length < 3) return null;
  const versionTag = blob.slice(0, 3).toString('utf8');
  if (versionTag !== 'v10') return null;
  const ciphertext = blob.slice(3);
  const iv = Buffer.alloc(16, 0x20);
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Copy the Cookies SQLite file (and its WAL/SHM siblings if present) to a
 * tempdir, then open the copy read-only. Avoids contention with a running
 * Brave/Chrome and gives us a self-contained file SQLite is happy with.
 */
function readCookieRowsForDomain(
  cookiesPath: string,
  domainSuffix: string,
): CookieRow[] | null {
  if (!existsSync(cookiesPath)) return null;
  const dir = mkdtempSync(join(tmpdir(), 'wt-cookies-'));
  const dst = join(dir, 'Cookies');
  try {
    copyFileSync(cookiesPath, dst);
    if (existsSync(`${cookiesPath}-wal`)) copyFileSync(`${cookiesPath}-wal`, `${dst}-wal`);
    if (existsSync(`${cookiesPath}-shm`)) copyFileSync(`${cookiesPath}-shm`, `${dst}-shm`);
    const db = new Database(dst, { readonly: true, fileMustExist: true });
    try {
      // We want hosts ending in `.skoda.vwgroup.com` OR equal to it.
      const rows = db
        .prepare(
          `SELECT host_key, name, value, encrypted_value
             FROM cookies
            WHERE host_key = ? OR host_key LIKE ?`,
        )
        .all(domainSuffix, `%.${domainSuffix}`) as unknown as CookieRow[];
      return rows;
    } finally {
      db.close();
    }
  } catch {
    return null;
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

/**
 * Return a `Cookie:` header value containing all cookies for `domainSuffix`
 * across the supported browsers, or null if none found / decrypt failed.
 * Tries browsers in priority order (Brave first, then Chrome).
 */
export function readJiraCookieHeader(domainSuffix: string): string | null {
  for (const browser of BROWSERS) {
    if (!existsSync(browser.cookiesPath)) continue;
    const password = readSafeStorageKey(browser.keychainEntry);
    if (!password) continue;
    const key = deriveAesKey(password);

    const rows = readCookieRowsForDomain(browser.cookiesPath, domainSuffix);
    if (!rows || rows.length === 0) continue;

    // Dedupe by name (rows are unordered); prefer the first non-empty value we
    // can resolve. Skip rows that decrypt to empty (no real session).
    const seen = new Set<string>();
    const pairs: CookiePair[] = [];
    for (const row of rows) {
      if (seen.has(row.name)) continue;
      let value = row.value;
      if ((!value || value.length === 0) && row.encrypted_value && row.encrypted_value.length > 0) {
        const decrypted = decryptV10(row.encrypted_value, key);
        if (decrypted == null) continue;
        value = decrypted;
      }
      if (!value) continue;
      seen.add(row.name);
      pairs.push({ name: row.name, value });
    }

    if (pairs.length > 0) {
      return pairs.map((p) => `${p.name}=${p.value}`).join('; ');
    }
  }
  return null;
}

/**
 * Open `url` in Brave if installed (its profile is the one jira-fetch already
 * primes), otherwise fall back to the system default via `open`.
 */
export function openLoginUrl(url: string): void {
  const brave = BROWSERS[0]!;
  if (existsSync(brave.appPath)) {
    spawn('open', ['-a', 'Brave Browser', url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
}
