import { spawnSync } from 'node:child_process';
import {
  openLoginUrl,
  readJiraCookieHeader,
  type CookieReadDiagnostic,
} from './browserCookies.js';

const KEYCHAIN_SERVICE = 'watchtower-jira-cookie';
const KEYCHAIN_ACCOUNT = 'default';
const KEYCHAIN_LABEL = 'Watchtower — Jira session cookies';

const BASE_URL = 'https://jira.skoda.vwgroup.com';
const LOGIN_URL = `${BASE_URL}/login.jsp`;
const MYSELF_URL = `${BASE_URL}/rest/api/2/myself`;
const DOMAIN = 'skoda.vwgroup.com';

const POLL_MS = 2000;
const TIMEOUT_MS = 5 * 60 * 1000;
/**
 * If after this many polls we still haven't read a single cookie from any
 * browser, give up early — the user either denied Keychain access, doesn't
 * have a supported browser, or is on a Brave version using v20 app-bound
 * encryption (which we can't decrypt). Forces the diagnostic out quickly
 * instead of making the user stare at "Waiting for sign-in…" for 5 minutes.
 */
const FAST_FAIL_POLLS_NO_COOKIES = 15;  // ~30 seconds
/**
 * Same idea, but for the case where cookies ARE coming through but Jira
 * keeps rejecting them. Usually means the user closed the login window
 * before SSO completed, or hit a different IdP path.
 */
const FAST_FAIL_POLLS_PROBE_REJECT = 30;  // ~60 seconds

export interface SignInResult {
  ok: boolean;
  error?: string;
}

/**
 * The "sign in" flow:
 *
 *   1. Open the Jira login URL in Brave (or default browser).
 *   2. Every 2s, read cookies for jira.skoda.vwgroup.com out of Brave's DB,
 *      decrypt them, and try GET /rest/api/2/myself with them.
 *   3. On 200, write the Cookie header to Watchtower's own Keychain slot,
 *      stop polling, and report success.
 *   4. Five-minute timeout otherwise.
 *
 * We only ever decrypt cookies whose host_key matches the Jira domain.
 * Other cookies in Brave's database aren't touched.
 */
export async function runBoardSignIn(): Promise<SignInResult> {
  // Pre-flight: probe every supported browser ONCE before opening the login
  // window. If nothing's readable at all (no cookies file, no Keychain
  // access, or DB locked), bail out immediately with an actionable error
  // instead of spawning a Brave window the user is then stuck staring at.
  {
    const preDiag: CookieReadDiagnostic[] = [];
    readJiraCookieHeader(DOMAIN, preDiag);
    const usable = preDiag.find(
      (d) => d.cookiesPathExists && d.keychainEntryFound,
    );
    if (!usable) {
      return { ok: false, error: buildPreflightMessage(preDiag) };
    }
  }

  openLoginUrl(LOGIN_URL);

  const startedAt = Date.now();
  let lastProbeStatus: number | null = null;
  let lastDiagnostics: CookieReadDiagnostic[] = [];
  let pollsWithoutCookies = 0;
  let pollsWithProbeReject = 0;

  while (Date.now() - startedAt < TIMEOUT_MS) {
    await sleep(POLL_MS);
    const diagnostics: CookieReadDiagnostic[] = [];
    const header = readJiraCookieHeader(DOMAIN, diagnostics);
    lastDiagnostics = diagnostics;

    if (!header) {
      pollsWithoutCookies += 1;
      if (pollsWithoutCookies >= FAST_FAIL_POLLS_NO_COOKIES) {
        return { ok: false, error: buildNoCookieMessage(diagnostics) };
      }
      continue;
    }
    pollsWithoutCookies = 0;

    let res: Response;
    try {
      res = await fetch(MYSELF_URL, {
        headers: { Cookie: header, Accept: 'application/json' },
      });
    } catch {
      continue;
    }
    lastProbeStatus = res.status;

    if (res.status === 200) {
      const stored = storeCookieInKeychain(header);
      if (!stored) {
        return { ok: false, error: 'Sign-in succeeded but Keychain write failed.' };
      }
      return { ok: true };
    }

    // Auth failure even though cookies exist — keep polling for a bit (user
    // might still be redirecting through IdP), then bail out with detail.
    pollsWithProbeReject += 1;
    if (pollsWithProbeReject >= FAST_FAIL_POLLS_PROBE_REJECT) {
      return {
        ok: false,
        error:
          `Sign-in failed: Jira rejected your browser's cookies (HTTP ${res.status}). ` +
          `Make sure you're fully signed in to ${BASE_URL} in Brave, then click Sign in again.`,
      };
    }
  }

  return {
    ok: false,
    error: buildTimeoutMessage(lastProbeStatus, lastDiagnostics),
  };
}

function buildPreflightMessage(diag: CookieReadDiagnostic[]): string {
  if (diag.length === 0) {
    return 'Sign-in failed: no supported browser (Brave or Chrome) found.';
  }
  const lines = diag.map((d) => {
    if (!d.cookiesPathExists) {
      return `${d.browser}: not installed (no cookies file at ${d.cookiesPath}).`;
    }
    if (!d.keychainEntryFound) {
      return (
        `${d.browser}: Keychain entry "${d.browser} Safe Storage" not accessible — ` +
        `open Keychain Access and grant Watchtower permission to read it, then retry.`
      );
    }
    return `${d.browser}: ${d.error ?? 'unknown read error'}.`;
  });
  return `Sign-in pre-check failed. ${lines.join(' | ')}`;
}

function buildNoCookieMessage(diag: CookieReadDiagnostic[]): string {
  const detail = diag
    .map((d) => {
      if (!d.cookiesPathExists) return null;
      if (!d.keychainEntryFound) return `${d.browser}: Keychain access denied.`;
      if (d.rowsReturned === 0) return `${d.browser}: 0 cookies for jira.skoda.vwgroup.com.`;
      if (d.rowsFailedDecrypt > 0 && d.rowsDecrypted === 0) {
        const tags = d.versionTagsSeen.join(', ') || 'none';
        return (
          `${d.browser}: ${d.rowsReturned} cookies present but all failed to decrypt ` +
          `(version tags: ${tags}; we only handle v10).`
        );
      }
      return `${d.browser}: ${d.rowsReturned} cookies, ${d.rowsDecrypted} decrypted, ${d.rowsWithPlaintext} plaintext.`;
    })
    .filter(Boolean)
    .join(' | ');
  return `Sign-in failed: no Jira cookies readable from your browser. ${detail}`;
}

function buildTimeoutMessage(
  lastProbeStatus: number | null,
  diagnostics: CookieReadDiagnostic[],
): string {
  if (lastProbeStatus !== null) {
    return (
      `Sign-in timed out: cookies were captured but Jira rejected them ` +
      `(HTTP ${lastProbeStatus}). Try logging in again in the browser window that just opened.`
    );
  }
  if (diagnostics.length === 0) {
    return 'Sign-in timed out: no supported browser (Brave or Chrome) found.';
  }
  const lines = diagnostics.map((d) => {
    if (!d.cookiesPathExists) return `${d.browser}: cookies file missing at ${d.cookiesPath}`;
    if (!d.keychainEntryFound)
      return `${d.browser}: Keychain entry not accessible. Approve the prompt in macOS Keychain Access.`;
    if (d.rowsReturned === 0) return `${d.browser}: 0 cookies stored for jira.skoda.vwgroup.com yet.`;
    if (d.rowsFailedDecrypt > 0 && d.rowsDecrypted === 0) {
      const tags = d.versionTagsSeen.join(', ') || 'unknown';
      return `${d.browser}: ${d.rowsReturned} rows, all failed to decrypt (version tags: ${tags}; expected "v10").`;
    }
    return `${d.browser}: ${d.rowsReturned} rows, ${d.rowsDecrypted} decrypted, ${d.rowsWithPlaintext} plaintext.`;
  });
  return `Sign-in timed out — no usable cookies for jira.skoda.vwgroup.com. ${lines.join(' | ')}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function storeCookieInKeychain(value: string): boolean {
  spawnSync(
    'security',
    ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT],
    { stdio: 'ignore' },
  );
  const r = spawnSync(
    'security',
    [
      'add-generic-password',
      '-s', KEYCHAIN_SERVICE,
      '-a', KEYCHAIN_ACCOUNT,
      '-l', KEYCHAIN_LABEL,
      '-w', value,
    ],
    { stdio: 'ignore' },
  );
  return r.status === 0;
}
