import { BrowserWindow, session } from 'electron';
import { spawnSync } from 'node:child_process';

const PARTITION = 'persist:watchtower-jira';
const KEYCHAIN_SERVICE = 'watchtower-jira-cookie';
const KEYCHAIN_ACCOUNT = 'default';
const KEYCHAIN_LABEL = 'Watchtower — Jira session cookies';

const BASE_URL = 'https://jira.skoda.vwgroup.com';
const LOGIN_URL = `${BASE_URL}/login.jsp`;
const MYSELF_URL = `${BASE_URL}/rest/api/2/myself`;

const POLL_MS = 2000;
const TIMEOUT_MS = 5 * 60 * 1000;

export interface SignInResult {
  ok: boolean;
  error?: string;
}

/**
 * Open a Jira login window in a dedicated Electron session partition.
 * Polls /rest/api/2/myself every 2s; when it returns 200, captures the
 * session cookies, writes them to Keychain, and closes the window.
 *
 * Doesn't share Keychain or cookies with the jira-fetch skill — Watchtower
 * has its own slot, so "no cookie stored" really means "user hasn't signed
 * into the Watchtower board yet".
 */
export async function runBoardSignIn(): Promise<SignInResult> {
  let win: BrowserWindow | null = null;
  try {
    win = new BrowserWindow({
      width: 1100,
      height: 800,
      title: 'Sign in to Jira',
      backgroundColor: '#0e0f12',
      webPreferences: { partition: PARTITION },
    });
    await win.loadURL(LOGIN_URL);
  } catch (err) {
    win?.destroy();
    return { ok: false, error: `Could not open sign-in window: ${(err as Error).message}` };
  }

  const sess = session.fromPartition(PARTITION);
  const startedAt = Date.now();

  while (Date.now() - startedAt < TIMEOUT_MS) {
    if (!win || win.isDestroyed()) {
      return { ok: false, error: 'Sign-in window was closed before login completed.' };
    }

    const cookies = await sess.cookies.get({ url: BASE_URL });
    if (cookies.length > 0) {
      const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      try {
        const res = await fetch(MYSELF_URL, {
          headers: { Cookie: cookieHeader, Accept: 'application/json' },
        });
        if (res.status === 200) {
          const stored = storeCookieInKeychain(cookieHeader);
          win.close();
          if (!stored) {
            return { ok: false, error: 'Sign-in succeeded but Keychain write failed.' };
          }
          return { ok: true };
        }
      } catch {
        // Network blip — keep polling.
      }
    }

    await sleep(POLL_MS);
  }

  if (win && !win.isDestroyed()) win.close();
  return { ok: false, error: 'Sign-in timed out after 5 minutes.' };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function storeCookieInKeychain(value: string): boolean {
  // Delete-then-add so the new value replaces any prior entry cleanly.
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
