// Jira worklog sync. Port of TimeTracker's server/routes/jira.ts adapted to
// Watchtower's orchestrator/SQLite layer. Auth mirrors TT exactly so a single
// Keychain entry serves both apps:
//   - JIRA_BASE_URL                  (required)
//   - JIRA_KEYCHAIN_ACCOUNT          (required)
//   - JIRA_KEYCHAIN_SERVICE          (defaults to 'jira-skoda-cookie')
// Cookie refresh runs ~/.claude/skills/jira-fetch/scripts/refresh_cookie.js
// via Playwright when the stored cookie is stale (same script TT uses).
import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SqliteLike } from '../db/migrations.js';
import type {
  OrchJiraSyncRequest,
  OrchJiraSyncResult,
  OrchJiraSyncEntry,
} from '../../shared/messagePort.js';

const JIRA_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;
const REFRESH_TIMEOUT_MS = 6 * 60 * 1000;
const DEFAULT_COMMENT = 'Práce na úkolu';

export interface JiraConfig {
  baseUrl: string;
  keychainService: string;
  keychainAccount: string;
  refreshScript: string;
}

// Defaults match the jira-fetch skill's refresh_cookie.js (same Keychain
// entry, so signing in via Watchtower or jira-fetch shares the session).
const DEFAULT_BASE_URL = 'https://jira.skoda.vwgroup.com';
const DEFAULT_KEYCHAIN_SERVICE = 'jira-skoda-cookie';
const DEFAULT_KEYCHAIN_ACCOUNT = 'dzc1cj8';

export function loadJiraConfigFromEnv(): JiraConfig {
  return {
    baseUrl: process.env.JIRA_BASE_URL || DEFAULT_BASE_URL,
    keychainService: process.env.JIRA_KEYCHAIN_SERVICE || DEFAULT_KEYCHAIN_SERVICE,
    keychainAccount: process.env.JIRA_KEYCHAIN_ACCOUNT || DEFAULT_KEYCHAIN_ACCOUNT,
    refreshScript: join(homedir(), '.claude/skills/jira-fetch/scripts/refresh_cookie.js'),
  };
}

export function isJiraConfigured(cfg: JiraConfig): boolean {
  return Boolean(cfg.baseUrl) && Boolean(cfg.keychainAccount);
}

/** Dependencies pulled out so unit tests can inject fakes. */
export interface JiraSyncDeps {
  readCookie(cfg: JiraConfig): string;
  runRefresh(cfg: JiraConfig): Promise<void>;
  fetch: typeof fetch;
  now(): Date;
}

export const defaultDeps: JiraSyncDeps = {
  readCookie(cfg) {
    const r = spawnSync(
      'security',
      ['find-generic-password', '-s', cfg.keychainService, '-a', cfg.keychainAccount, '-w'],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) return '';
    return r.stdout.trim();
  },
  runRefresh(cfg) {
    return new Promise<void>((resolve, reject) => {
      // Pipe stdio so the chatty Playwright output doesn't flow through the
      // orchestrator's inherited pipe (which has been observed to destabilise
      // the utility process). We drain both streams and capture stderr so it
      // can be surfaced to the renderer when the child exits non-zero.
      const child = spawn('node', [cfg.refreshScript], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stdout?.on('data', () => {
        /* drain — refresh script prints nothing meaningful on stdout */
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        // Cap the buffer so a runaway script can't blow up memory.
        if (stderr.length < 16_384) stderr += chunk.toString('utf8');
      });

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Jira SSO browser timed out (5 min)'));
      }, REFRESH_TIMEOUT_MS);

      child.on('error', (err) => {
        clearTimeout(timer);
        // ENOENT — `node` not found on PATH inside the utility process. Surface
        // a hint that's actionable instead of the cryptic underlying message.
        const msg = (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'Cookie refresh failed: `node` not on PATH for the orchestrator child'
          : `Cookie refresh failed: ${err.message}`;
        reject(new Error(msg));
      });

      child.on('exit', (code) => {
        clearTimeout(timer);
        const tail = stderr ? ` — stderr: ${stderr.trim().slice(-400)}` : '';
        if (code === 0) resolve();
        else if (code === 2)
          reject(new Error(`SSO login timed out (close any leftover browser window and retry)${tail}`));
        else if (code === 3)
          reject(new Error(`Keychain write failed during cookie refresh${tail}`));
        else reject(new Error(`Cookie refresh exited with code ${code}${tail}`));
      });
    });
  },
  fetch: globalThis.fetch.bind(globalThis),
  now: () => new Date(),
};

interface CandidateRow {
  id: number;
  task_id: number;
  task_number: string;
  task_title: string;
  task_status: 'open' | 'in_progress' | 'done';
  description: string | null;
  work_date: string;
  minutes: number;
  reported_minutes: number | null;
  source: string | null;
  external_id: string | null;
  jira_uploaded: number;
  project_id: number;
}

function loadCandidates(
  db: SqliteLike,
  from: string,
  to: string,
  projectId: number | undefined,
): CandidateRow[] {
  const params: unknown[] = [from, to];
  let projectFilter = '';
  if (projectId !== undefined) {
    projectFilter = ' AND p.id = ?';
    params.push(projectId);
  }
  return db
    .prepare(
      `SELECT w.id, w.task_id, w.description, w.work_date, w.minutes, w.reported_minutes,
              w.source, w.external_id, w.jira_uploaded,
              t.number AS task_number, t.title AS task_title, t.status AS task_status,
              p.id AS project_id
         FROM worklogs w
         JOIN tasks t ON t.id = w.task_id
         JOIN epics e ON e.id = t.epic_id
         JOIN projects p ON p.id = e.project_id
         WHERE w.work_date BETWEEN ? AND ?${projectFilter}
         ORDER BY w.work_date ASC, w.id ASC`,
    )
    .all(...params) as CandidateRow[];
}

function minutesToJiraTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function formatStarted(workDate: string, now: Date): string {
  // Jira `started` ISO 8601 with millis + offset. Anchor old worklogs to 09:00
  // local on their work_date — we don't track per-worklog start times.
  // The timezone offset is derived from `now` so unit tests can pin it via the
  // deps stub instead of inheriting the runner's TZ.
  const tzOffsetMin = -now.getTimezoneOffset();
  const sign = tzOffsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(tzOffsetMin);
  const tzH = String(Math.floor(abs / 60)).padStart(2, '0');
  const tzM = String(abs % 60).padStart(2, '0');
  return `${workDate}T09:00:00.000${sign}${tzH}${tzM}`;
}

function pickComment(description: string | null): string {
  const trimmed = description?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : DEFAULT_COMMENT;
}

function pickMinutes(row: CandidateRow): number {
  return row.reported_minutes && row.reported_minutes > 0
    ? row.reported_minutes
    : row.minutes;
}

function buildEntry(row: CandidateRow): OrchJiraSyncEntry {
  const minutes = pickMinutes(row);
  return {
    worklogId: row.id,
    taskId: row.task_id,
    taskNumber: row.task_number,
    taskTitle: row.task_title,
    workDate: row.work_date,
    minutes,
    timeSpent: minutesToJiraTime(minutes),
    comment: pickComment(row.description),
    status: 'pending',
  };
}

function markPosted(db: SqliteLike, worklogId: number, jiraId: string): void {
  db.prepare(
    `UPDATE worklogs
       SET source = 'jira', external_id = ?, jira_uploaded = 1
       WHERE id = ?`,
  ).run(jiraId, worklogId);
}

function markTaskDoneIfAllPosted(db: SqliteLike, taskId: number): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS unposted
         FROM worklogs
         WHERE task_id = ? AND jira_uploaded = 0`,
    )
    .get(taskId) as { unposted: number };
  if (row.unposted > 0) return false;
  const r = db
    .prepare(`UPDATE tasks SET status = 'done' WHERE id = ? AND status != 'done'`)
    .run(taskId) as { changes: number };
  return r.changes > 0;
}

interface PostOutcome {
  ok: boolean;
  status: number;
  worklogId?: string;
  error?: string;
}

async function postOne(
  deps: JiraSyncDeps,
  cfg: JiraConfig,
  cookie: string,
  key: string,
  body: { timeSpent: string; started: string; comment: string },
): Promise<PostOutcome> {
  const res = await deps.fetch(`${cfg.baseUrl}/rest/api/2/issue/${key}/worklog`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (res.status >= 200 && res.status < 300) {
    const data = (await res.json().catch(() => null)) as { id?: unknown } | null;
    const id = data && typeof data.id === 'string' ? data.id : undefined;
    return { ok: true, status: res.status, worklogId: id };
  }
  const text = await res.text().catch(() => '');
  return {
    ok: false,
    status: res.status,
    error: text.slice(0, 400) || `HTTP ${res.status}`,
  };
}

function isAuthFailure(status: number): boolean {
  return status === 401 || status === 403 || status === 302 || status === 303;
}

function emptyResult(dryRun: boolean): OrchJiraSyncResult {
  return {
    totalCandidates: 0,
    skippedNoJiraKey: 0,
    skippedAlreadyPosted: 0,
    skippedTaskNotOpen: 0,
    attempted: 0,
    posted: 0,
    failed: 0,
    tasksMarkedDone: 0,
    neededBrowserRefresh: false,
    dryRun,
    entries: [],
  };
}

export interface JiraSyncServiceOptions {
  config?: JiraConfig;
  deps?: JiraSyncDeps;
}

export class JiraSyncService {
  private readonly cfg: JiraConfig;
  private readonly deps: JiraSyncDeps;

  constructor(
    private readonly db: SqliteLike,
    opts: JiraSyncServiceOptions = {},
  ) {
    this.cfg = opts.config ?? loadJiraConfigFromEnv();
    this.deps = opts.deps ?? defaultDeps;
  }

  isConfigured(): boolean {
    return isJiraConfigured(this.cfg);
  }

  preview(req: OrchJiraSyncRequest): OrchJiraSyncResult {
    if (!this.isConfigured()) {
      return {
        ...emptyResult(true),
        error:
          'Jira sync is not configured — set JIRA_BASE_URL and JIRA_KEYCHAIN_ACCOUNT.',
      };
    }
    const rows = loadCandidates(this.db, req.from, req.to, req.projectId);
    const result = emptyResult(true);
    result.totalCandidates = rows.length;
    const onlyUnposted = req.onlyUnposted !== false;

    for (const row of rows) {
      if (!JIRA_KEY_RE.test(row.task_number)) {
        result.skippedNoJiraKey += 1;
        continue;
      }
      if (row.task_status !== 'open') {
        result.skippedTaskNotOpen += 1;
        continue;
      }
      const alreadyPosted = row.jira_uploaded === 1;
      if (alreadyPosted && onlyUnposted) {
        result.skippedAlreadyPosted += 1;
        continue;
      }
      const entry = buildEntry(row);
      entry.alreadyPosted = alreadyPosted;
      entry.status = alreadyPosted ? 'skipped' : 'pending';
      if (alreadyPosted) {
        entry.reason =
          row.source === 'jira'
            ? 'Already posted to Jira'
            : `Already in Jira via ${row.source ?? 'unknown source'}`;
      }
      result.entries.push(entry);
    }
    result.attempted = result.entries.filter((e) => e.status === 'pending').length;
    return result;
  }

  async sync(req: OrchJiraSyncRequest): Promise<OrchJiraSyncResult> {
    if (!this.isConfigured()) {
      return {
        ...emptyResult(false),
        error:
          'Jira sync is not configured — set JIRA_BASE_URL and JIRA_KEYCHAIN_ACCOUNT.',
      };
    }
    const rows = loadCandidates(this.db, req.from, req.to, req.projectId);
    const result = emptyResult(false);
    result.totalCandidates = rows.length;
    const onlyUnposted = req.onlyUnposted !== false;

    const toPost: { row: CandidateRow; entry: OrchJiraSyncEntry }[] = [];
    for (const row of rows) {
      if (!JIRA_KEY_RE.test(row.task_number)) {
        result.skippedNoJiraKey += 1;
        continue;
      }
      if (row.task_status !== 'open') {
        result.skippedTaskNotOpen += 1;
        continue;
      }
      const alreadyPosted = row.jira_uploaded === 1;
      if (alreadyPosted) {
        result.skippedAlreadyPosted += 1;
        if (!onlyUnposted) {
          const entry = buildEntry(row);
          entry.alreadyPosted = true;
          entry.status = 'skipped';
          entry.reason =
            row.source === 'jira'
              ? 'Already posted to Jira'
              : `Already in Jira via ${row.source ?? 'unknown source'}`;
          result.entries.push(entry);
        }
        continue;
      }
      const entry = buildEntry(row);
      result.entries.push(entry);
      toPost.push({ row, entry });
    }

    if (toPost.length === 0) {
      return result;
    }

    let cookie = this.deps.readCookie(this.cfg);
    let refreshed = false;

    const ensureFreshCookie = async (): Promise<void> => {
      if (refreshed) {
        throw new Error('Auth failed even after browser refresh');
      }
      result.neededBrowserRefresh = true;
      await this.deps.runRefresh(this.cfg);
      cookie = this.deps.readCookie(this.cfg);
      if (!cookie) throw new Error('Cookie refresh ran but no cookie was stored');
      refreshed = true;
    };

    if (!cookie) {
      try {
        await ensureFreshCookie();
      } catch (err) {
        return { ...result, error: (err as Error).message };
      }
    }

    for (const { row, entry } of toPost) {
      const body = {
        timeSpent: entry.timeSpent,
        started: formatStarted(entry.workDate, this.deps.now()),
        comment: entry.comment,
      };
      let outcome = await postOne(this.deps, this.cfg, cookie, row.task_number, body);

      if (!outcome.ok && isAuthFailure(outcome.status)) {
        try {
          await ensureFreshCookie();
          outcome = await postOne(this.deps, this.cfg, cookie, row.task_number, body);
        } catch (err) {
          entry.status = 'failed';
          entry.reason = (err as Error).message;
          result.failed += 1;
          continue;
        }
      }

      if (outcome.ok && outcome.worklogId) {
        markPosted(this.db, row.id, outcome.worklogId);
        entry.status = 'posted';
        entry.jiraWorklogId = outcome.worklogId;
        entry.jiraWorklogUrl = `${this.cfg.baseUrl}/browse/${row.task_number}?focusedWorklogId=${outcome.worklogId}`;
        result.posted += 1;
      } else if (outcome.ok) {
        // Jira accepted but didn't return an id we recognise — count it but
        // don't fabricate an external_id (leaves the row syncable next run).
        entry.status = 'posted';
        result.posted += 1;
      } else {
        entry.status = 'failed';
        entry.reason = `Jira HTTP ${outcome.status}: ${outcome.error ?? 'unknown error'}`;
        result.failed += 1;
      }
    }

    result.attempted = toPost.length;

    // After all posts complete, mark tasks done if every worklog under them
    // now has jira_uploaded=1. Only consider tasks we touched in this run.
    const touchedTaskIds = new Set<number>();
    for (const { row, entry } of toPost) {
      if (entry.status === 'posted') touchedTaskIds.add(row.task_id);
    }
    for (const taskId of touchedTaskIds) {
      if (markTaskDoneIfAllPosted(this.db, taskId)) result.tasksMarkedDone += 1;
    }

    return result;
  }
}
