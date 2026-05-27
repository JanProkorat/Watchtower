import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Run the jira-fetch skill's Playwright SSO refresh from Electron main —
 * exactly the script the worklog sync uses for its cookie refresh. The
 * script opens its own Chromium window, polls /rest/api/2/myself, and
 * closes itself when the session is alive. Cookies land in the shared
 * Keychain entry (`jira-skoda-cookie` / `dzc1cj8`), which the orchestrator's
 * board sync then reads on its next call.
 *
 * We run it from main (not the orchestrator utility process) and pipe-then-
 * drain stdout/stderr so Playwright's chatty output doesn't flow through
 * any of the orchestrator's plumbing.
 */
const REFRESH_SCRIPT = join(
  homedir(),
  '.claude/skills/jira-fetch/scripts/refresh_cookie.js',
);
const TIMEOUT_MS = 6 * 60 * 1000;

export interface SignInResult {
  ok: boolean;
  error?: string;
}

export async function runBoardSignIn(): Promise<SignInResult> {
  return new Promise<SignInResult>((resolve) => {
    const child = spawn('node', [REFRESH_SCRIPT], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stdout?.on('data', () => {
      /* drain — refresh script prints nothing meaningful on stdout */
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 16_384) stderr += chunk.toString('utf8');
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ ok: false, error: 'Jira SSO browser timed out (5 min).' });
    }, TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timer);
      const code = (err as NodeJS.ErrnoException).code;
      const msg =
        code === 'ENOENT'
          ? '`node` not on PATH — cannot launch the Jira sign-in browser.'
          : `Sign-in failed: ${err.message}`;
      resolve({ ok: false, error: msg });
    });

    child.on('exit', (code) => {
      clearTimeout(timer);
      const tail = stderr ? ` — ${stderr.trim().slice(-400)}` : '';
      if (code === 0) {
        resolve({ ok: true });
        return;
      }
      const reason =
        code === 2
          ? 'SSO login timed out (close any leftover browser window and retry)'
          : code === 3
            ? 'Keychain write failed during cookie refresh'
            : `Cookie refresh exited with code ${code}`;
      resolve({ ok: false, error: reason + tail });
    });
  });
}
