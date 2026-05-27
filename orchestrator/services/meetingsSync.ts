// Outlook → Watchtower meetings sync — drives the global /sync-meetings
// Claude slash command.
//
// The skill at ~/.claude/commands/sync-meetings.md accepts three positional
// arguments: FROM, TO, and (optionally) DB_PATH. When the user types
// /sync-meetings in chat without DB_PATH the skill asks them which DB to
// write to. We pass Watchtower's DB path here so the skill never prompts —
// the worklogs land directly in Watchtower's SQLite.
//
// Known limitation: in the user's environment `claude -p` can hang on
// Microsoft 365 MCP initialization for non-interactive subprocesses, with
// no actionable error surface. We still wire this up because the skill
// itself works fine from chat. If the spawn hangs, the timeout below
// trips after 180s and returns a clear error.
//
// All routing + DB insert logic lives in
// ~/.claude/commands/log-meetings.mjs, which the skill invokes. The
// orchestrator just spawns claude, captures the summary line, and reports.

import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqliteLike } from '../db/migrations.js';

export interface MeetingsSyncRequest {
  /** Inclusive YYYY-MM-DD. */
  from: string;
  /** Inclusive YYYY-MM-DD. */
  to: string;
}

export interface MeetingsSyncResult {
  ok: boolean;
  exitCode: number | null;
  /** The "Summary: …" line from the skill, surfaced verbatim. */
  summary: string;
  logged: number;
  skipped: number;
  unresolved: number;
  duplicate: number;
  total: number;
  error?: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SPAWN_TIMEOUT_MS = 180_000;

/**
 * Watchtower's SQLite lives under macOS's Application Support directory.
 * The path is fixed (matches `supportDir()` in orchestrator/index.ts).
 */
function watchtowerDbPath(): string {
  return join(homedir(), 'Library', 'Application Support', 'Watchtower', 'data.db');
}

function isRealDir(p: string | undefined | null): p is string {
  if (!p) return false;
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The slash command lives at ~/.claude/commands/sync-meetings.md so claude
 * picks it up automatically from the user's home directory. We pass
 * `--add-dir <dir>` only as a safety net for environments where claude's
 * default search path is unusual; in practice the home dir is always
 * scanned.
 */
function resolveAddDir(): string | null {
  if (process.env.WATCHTOWER_SKILLS_DIR && isRealDir(process.env.WATCHTOWER_SKILLS_DIR)) {
    return process.env.WATCHTOWER_SKILLS_DIR;
  }
  const repoRoot = resolve(__dirname, '..', '..', '..');
  if (isRealDir(repoRoot)) return repoRoot;
  return null;
}

interface SpawnOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

function spawnClaudeSync(
  from: string,
  to: string,
  dbPath: string,
): Promise<SpawnOutcome> {
  return new Promise<SpawnOutcome>((resolvePromise) => {
    const addDir = resolveAddDir();
    const addDirArg = addDir ? ` --add-dir ${JSON.stringify(addDir)}` : '';
    // dbPath is quoted because it contains "Application Support" with a
    // space. FROM/TO are pre-validated against ISO_DATE_RE so no shell
    // metachars are possible.
    const slashArg = `'/sync-meetings ${from} ${to} ${JSON.stringify(dbPath)}'`;
    const cmd = `claude -p ${slashArg} --output-format text${addDirArg}`;
    console.log(`[meetings:sync] spawning: ${cmd}`);
    const child = spawn('/bin/zsh', ['-lc', cmd], {
      cwd: homedir(),
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolvePromise({
        exitCode: null,
        stdout,
        stderr,
        error: `claude timed out after ${Math.round(SPAWN_TIMEOUT_MS / 1000)}s`,
      });
    }, SPAWN_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ exitCode: null, stdout, stderr, error: err.message });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.log(`[meetings:sync] claude exited with code=${code}`);
      if (stdout.trim()) console.log(`[meetings:sync] stdout tail: ${stdout.trim().slice(-400)}`);
      if (stderr.trim()) console.log(`[meetings:sync] stderr tail: ${stderr.trim().slice(-400)}`);
      resolvePromise({ exitCode: code, stdout, stderr });
    });
  });
}

/**
 * Parse the skill's "Summary: X logged, Y duplicate, …" line into counts.
 * Returns zeros if the line is missing or malformed.
 */
function parseSummary(stdout: string): {
  summaryLine: string;
  logged: number;
  duplicate: number;
  skipped: number;
  unresolved: number;
  total: number;
} {
  const summaryLine =
    stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('Summary'))
      .pop() ?? '';
  const counts = { logged: 0, duplicate: 0, skipped: 0, unresolved: 0, total: 0 };
  for (const [field, re] of [
    ['logged', /(\d+)\s+logged/],
    ['duplicate', /(\d+)\s+duplicate/],
    ['skipped', /(\d+)\s+skipped/],
    ['unresolved', /(\d+)\s+unresolved/],
    ['total', /(\d+)\s+total/],
  ] as const) {
    const m = summaryLine.match(re);
    if (m?.[1]) counts[field] = Number(m[1]);
  }
  return { summaryLine, ...counts };
}

export class MeetingsSyncService {
  // We accept a db reference for symmetry with other services even though
  // the actual DB write happens in log-meetings.mjs.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(private _db: SqliteLike) {}

  async sync(request: MeetingsSyncRequest): Promise<MeetingsSyncResult> {
    console.log(`[meetings:sync] start ${request.from} → ${request.to}`);
    if (!ISO_DATE_RE.test(request.from) || !ISO_DATE_RE.test(request.to)) {
      return emptyResult({ ok: false, error: 'from/to must be YYYY-MM-DD' });
    }
    if (request.from > request.to) {
      return emptyResult({ ok: false, error: 'from must be on or before to' });
    }

    const dbPath = watchtowerDbPath();
    if (!existsSync(dbPath)) {
      return emptyResult({
        ok: false,
        error: `Watchtower DB not found at ${dbPath}. Run the app once to initialise it.`,
      });
    }

    const claude = await spawnClaudeSync(request.from, request.to, dbPath);

    if (claude.exitCode === null) {
      return emptyResult({ ok: false, error: claude.error ?? 'claude did not exit' });
    }

    const parsed = parseSummary(claude.stdout);

    if (claude.exitCode !== 0 && !parsed.summaryLine) {
      // No summary printed and a non-zero exit means the skill never ran
      // its logger. Surface stderr/stdout so the user can see what went
      // wrong (auth, MCP, etc.).
      const tail = claude.stderr.trim().slice(-400) || claude.stdout.trim().slice(-400);
      return emptyResult({
        ok: false,
        exitCode: claude.exitCode,
        error: tail || `claude exited with code ${claude.exitCode}`,
      });
    }

    return {
      ok: claude.exitCode === 0 && parsed.unresolved === 0,
      exitCode: claude.exitCode,
      summary: parsed.summaryLine || 'Sync schůzek dokončen.',
      logged: parsed.logged,
      duplicate: parsed.duplicate,
      skipped: parsed.skipped,
      unresolved: parsed.unresolved,
      total: parsed.total,
    };
  }
}

function emptyResult(
  overrides: Partial<MeetingsSyncResult> & Pick<MeetingsSyncResult, 'ok'>,
): MeetingsSyncResult {
  return {
    exitCode: null,
    summary: '',
    logged: 0,
    skipped: 0,
    unresolved: 0,
    duplicate: 0,
    total: 0,
    ...overrides,
  };
}
