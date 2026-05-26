import { spawnSync } from 'node:child_process';

const KEYCHAIN_SERVICE = 'watchtower-jira-cookie';
const KEYCHAIN_ACCOUNT = 'default';
const KEYCHAIN_LABEL = 'Watchtower — Jira session cookies';

const BASE_URL = 'https://jira.skoda.vwgroup.com';
const MYSELF_URL = `${BASE_URL}/rest/api/2/myself`;

export interface SignInResult {
  ok: boolean;
  error?: string;
}

/**
 * Validate a user-pasted Cookie header value against Jira, and on success
 * write it to the Watchtower-specific Keychain slot. The renderer hands us
 * the raw paste from devtools; we strip any leading "Cookie: " and probe
 * `/rest/api/2/myself` to confirm the session is alive before storing.
 *
 * We don't try to read system-browser cookie databases — too invasive and
 * too brittle across Brave/Chrome/Safari/etc. The paste step is the price
 * we pay for native Touch ID / passkey support in the user's system browser.
 */
export async function storeBoardCookie(rawCookie: string): Promise<SignInResult> {
  const cookie = stripCookieHeaderPrefix((rawCookie ?? '').trim());
  if (!cookie) {
    return { ok: false, error: 'Empty cookie value.' };
  }
  if (!/=/.test(cookie)) {
    return {
      ok: false,
      error: 'That doesn\'t look like a Cookie header. Paste the full `name=value; …` string.',
    };
  }

  let res: Response;
  try {
    res = await fetch(MYSELF_URL, {
      headers: { Cookie: cookie, Accept: 'application/json' },
    });
  } catch (err) {
    return {
      ok: false,
      error: `Could not reach Jira: ${(err as Error).message}`,
    };
  }

  if (res.status === 401 || res.status === 403 || res.status === 302 || res.status === 303) {
    return {
      ok: false,
      error: 'Jira rejected the cookie (auth failed). Log in again in your browser and copy a fresh Cookie header.',
    };
  }
  if (res.status < 200 || res.status >= 300) {
    return {
      ok: false,
      error: `Jira returned HTTP ${res.status} when checking the cookie.`,
    };
  }

  const stored = storeCookieInKeychain(cookie);
  if (!stored) {
    return { ok: false, error: 'Cookie validated, but writing to macOS Keychain failed.' };
  }
  return { ok: true };
}

function stripCookieHeaderPrefix(s: string): string {
  return s.replace(/^cookie:\s*/i, '').trim();
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
