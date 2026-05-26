import { spawnSync } from 'node:child_process';
import { openLoginUrl, readJiraCookieHeader } from './browserCookies.js';

const KEYCHAIN_SERVICE = 'watchtower-jira-cookie';
const KEYCHAIN_ACCOUNT = 'default';
const KEYCHAIN_LABEL = 'Watchtower — Jira session cookies';

const BASE_URL = 'https://jira.skoda.vwgroup.com';
const LOGIN_URL = `${BASE_URL}/login.jsp`;
const MYSELF_URL = `${BASE_URL}/rest/api/2/myself`;
const DOMAIN = 'skoda.vwgroup.com';

const POLL_MS = 2000;
const TIMEOUT_MS = 5 * 60 * 1000;

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
  openLoginUrl(LOGIN_URL);

  const startedAt = Date.now();
  let triedAtLeastOnce = false;

  while (Date.now() - startedAt < TIMEOUT_MS) {
    await sleep(POLL_MS);
    const header = readJiraCookieHeader(DOMAIN);
    if (!header) continue;
    triedAtLeastOnce = true;

    let res: Response;
    try {
      res = await fetch(MYSELF_URL, {
        headers: { Cookie: header, Accept: 'application/json' },
      });
    } catch {
      continue;
    }

    if (res.status === 200) {
      const stored = storeCookieInKeychain(header);
      if (!stored) {
        return { ok: false, error: 'Sign-in succeeded but Keychain write failed.' };
      }
      return { ok: true };
    }
    // 401/403/redirect → cookie present but not yet authenticated.
    // Keep polling — the user might still be on the IdP page.
  }

  return {
    ok: false,
    error: triedAtLeastOnce
      ? 'Sign-in timed out: Jira didn\'t accept the cookies in your browser. Try logging in again.'
      : 'Sign-in timed out: no Jira cookies appeared in your browser. Make sure you completed the login in Brave or Chrome.',
  };
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
