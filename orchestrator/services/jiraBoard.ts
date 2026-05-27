import type { SqliteLike } from '../db/migrations.js';
import {
  defaultDeps,
  loadJiraConfigFromEnv,
  type JiraConfig,
  type JiraSyncDeps,
} from './jiraSync.js';
import { ProjectsRepo } from '../db/repositories/projects.js';
import { EpicsRepo } from '../db/repositories/epics.js';
import { TasksRepo } from '../db/repositories/tasks.js';
import { detectAreaCode, pickProjectForKey } from './jiraRouting.js';
import type {
  BoardAuthPingPayload,
  BoardCardPayload,
  BoardColumn,
  BoardSnapshotPayload,
  BoardSyncResultPayload,
  ProjectViewPayload,
} from '../../shared/ipcContract.js';

/** Deps for the board sync — identical surface to the worklog sync. */
export type BoardSyncDeps = JiraSyncDeps;

/** Raw Jira status → merged Watchtower column. */
export const STATUS_TO_COLUMN: Record<string, BoardColumn> = {
  'New':         'todo',
  'To Do':       'todo',
  'In Progress': 'doing',
  'In Review':   'doing',
  'In Test':     'done',
  'To Accept':   'done',
  'Done':        'done',
};

/**
 * Statuses we deliberately hide from the board even if they're still on the
 * user's Jira board. Kept separate from STATUS_TO_COLUMN so legacy rows that
 * synced before the JQL exclusion landed still get dropped from the snapshot.
 */
export const HIDDEN_STATUSES: ReadonlySet<string> = new Set(['Waiting']);

/** Merged column → local `tasks.status` enum. */
export const COLUMN_TO_LOCAL_STATUS: Record<BoardColumn, 'open' | 'in_progress' | 'done'> = {
  todo:  'open',
  doing: 'in_progress',
  done:  'done',
};

interface SnapshotRow {
  task_id: number;
  jira_key: string;
  title: string;
  jira_status: string;
  jira_estimate_secs: number | null;
  jira_component: string | null;
  jira_synced_at: string | null;
  logged_minutes: number;
  project_id: number;
  project_name: string;
  project_color: string;
  epic_id: number;
  epic_name: string;
}

// Push NULL estimates to the bottom, then estimate desc, then key asc for a
// stable within-column order.
const SNAPSHOT_SQL = `
  SELECT
    t.id            AS task_id,
    t.number        AS jira_key,
    t.title         AS title,
    t.jira_status   AS jira_status,
    t.jira_estimate_secs AS jira_estimate_secs,
    t.jira_component AS jira_component,
    t.jira_synced_at AS jira_synced_at,
    (SELECT COALESCE(SUM(w.minutes), 0)
       FROM worklogs w WHERE w.task_id = t.id) AS logged_minutes,
    p.id            AS project_id,
    p.name          AS project_name,
    p.color         AS project_color,
    e.id            AS epic_id,
    e.name          AS epic_name
  FROM tasks t
  JOIN epics    e ON e.id = t.epic_id
  JOIN projects p ON p.id = e.project_id
  WHERE t.jira_status IS NOT NULL
  ORDER BY (t.jira_estimate_secs IS NULL), t.jira_estimate_secs DESC, t.number ASC
`;

export interface JiraBoardServiceOptions {
  config?: JiraConfig;
  deps?: BoardSyncDeps;
  /**
   * Override for the Epic Link customfield discovery. When provided,
   * `discoverEpicFieldId` is skipped entirely — pass a real id (e.g.
   * `customfield_10006`) to force epic-link routing, or `null` to skip
   * it. Defaults to "auto" (read disk cache + probe /rest/api/2/field).
   * Mostly useful for tests.
   */
  epicLinkFieldId?: string | null;
}

export class JiraBoardService {
  private readonly cfg: JiraConfig;
  private readonly deps: BoardSyncDeps;
  private readonly epicLinkFieldIdOverride: string | null | undefined;

  constructor(
    private readonly db: SqliteLike,
    opts: JiraBoardServiceOptions = {},
  ) {
    this.cfg = opts.config ?? loadJiraConfigFromEnv();
    this.deps = opts.deps ?? defaultDeps;
    this.epicLinkFieldIdOverride =
      'epicLinkFieldId' in opts ? opts.epicLinkFieldId : undefined;
  }

  authPing(): BoardAuthPingPayload {
    const configured = Boolean(this.cfg.baseUrl) && Boolean(this.cfg.keychainAccount);
    const cookiePresent = configured ? Boolean(this.deps.readCookie(this.cfg)) : false;
    return {
      configured,
      cookiePresent,
      baseUrl: this.cfg.baseUrl || null,
    };
  }

  getSnapshot(): BoardSnapshotPayload {
    const rows = this.db.prepare(SNAPSHOT_SQL).all() as SnapshotRow[];
    const cards: BoardCardPayload[] = rows
      .filter((r) => !HIDDEN_STATUSES.has(r.jira_status))
      .map((r) => ({
        taskId: r.task_id,
        jiraKey: r.jira_key,
        title: r.title,
        jiraStatus: r.jira_status,
        // Default unknown statuses to 'doing' — they're in flight by definition.
        column: STATUS_TO_COLUMN[r.jira_status] ?? 'doing',
        estimateSeconds: r.jira_estimate_secs,
        loggedMinutes: r.logged_minutes,
        component: r.jira_component,
        projectId: r.project_id,
        projectName: r.project_name,
        projectColor: r.project_color,
        epicId: r.epic_id,
        epicName: r.epic_name,
        syncedAt: r.jira_synced_at,
      }));
    const syncedAt = cards.reduce<string | null>((max, c) => {
      if (!c.syncedAt) return max;
      if (!max || c.syncedAt > max) return c.syncedAt;
      return max;
    }, null);
    return { cards, syncedAt, lastSyncResult: null };
  }

  async sync(): Promise<BoardSyncResultPayload> {
    const startedAt = this.deps.now().toISOString();
    try {
      return await this.syncInner(startedAt);
    } catch (err) {
      // Last-resort catch: any unanticipated throw (DB constraint, JSON
      // parse error, network exception, etc.) returns a clean envelope
      // instead of bubbling out of the IPC handler and killing the
      // orchestrator process. Node's undici fetch reports "fetch failed"
      // generically; the real reason lives in `err.cause` (e.g.
      // ENOTFOUND / certificate chain / ECONNREFUSED) — chase it.
      return earlyError(
        startedAt,
        this.deps.now(),
        false,
        `Board sync crashed: ${formatErrorChain(err)}`,
      );
    }
  }

  private async syncInner(startedAt: string): Promise<BoardSyncResultPayload> {
    if (!this.cfg.baseUrl || !this.cfg.keychainAccount) {
      return notConfiguredResult(startedAt, this.deps.now());
    }

    const cookie = this.deps.readCookie(this.cfg);
    if (!cookie) {
      return earlyError(
        startedAt,
        this.deps.now(),
        false,
        'No Jira session cookie. Sign in to Jira first.',
      );
    }

    // Discover (and cache) the custom-field id for "Epic Link" so issues
    // can be slotted under the same epic Jira uses, not a guessed area
    // code. Failure here is non-fatal — we fall back to area-code routing.
    const epicFieldId = await this.discoverEpicFieldId(cookie);

    const searchFields = ['summary', 'status', 'timeoriginalestimate', 'labels', 'components'];
    if (epicFieldId) searchFields.push(epicFieldId);

    const url = `${this.cfg.baseUrl}/rest/api/2/search`;
    const reqBody = JSON.stringify({
      jql: JQL,
      fields: searchFields,
      maxResults: MAX_RESULTS,
    });
    const res = await this.deps.fetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: reqBody,
    });

    if (isAuthFailure(res.status) || res.status === 0) {
      return {
        ...earlyError(
          startedAt,
          this.deps.now(),
          false,
          'Jira session expired. Sign in to Jira to refresh.',
        ),
        authFailed: true,
      };
    }
    if (res.status < 200 || res.status >= 300) {
      const text = await res.text().catch(() => '');
      return earlyError(
        startedAt,
        this.deps.now(),
        false,
        `Jira HTTP ${res.status}: ${text.slice(0, 400) || 'no body'}`,
      );
    }

    const data = (await res.json().catch(() => ({}))) as { issues?: JiraIssueHit[] };
    const issues = data.issues ?? [];

    const projectsRepo = new ProjectsRepo(this.db);
    const epicsRepo = new EpicsRepo(this.db);
    const tasksRepo = new TasksRepo(this.db);
    const allProjects = projectsRepo.list({}) as unknown as ProjectViewPayload[];

    // Pre-fetch Jira summaries for every unique epic key referenced by the
    // result set, so newly-created local epics get a real name instead of
    // just the issue key. One JQL request handles all of them.
    const epicKeys = new Set<string>();
    if (epicFieldId) {
      for (const hit of issues) {
        const k = readEpicKey(hit, epicFieldId);
        if (k) epicKeys.add(k);
      }
    }
    const epicSummaries = await this.fetchEpicSummaries(cookie, [...epicKeys]);

    const syncedAt = this.deps.now().toISOString();
    let created = 0;
    let upserted = 0;
    let unrouted = 0;
    const unroutedKeys: string[] = [];
    const seenKeys: string[] = [];

    for (const hit of issues) {
      seenKeys.push(hit.key);
      const rawStatus = hit.fields.status.name;
      const column = STATUS_TO_COLUMN[rawStatus];
      const localStatus = column ? COLUMN_TO_LOCAL_STATUS[column] : 'open';

      // Resolve target local project first — we need it to scope the epic.
      const project = pickProjectForKey(hit.key, allProjects);
      const existing = tasksRepo.findByNumber(hit.key);

      // Figure out the desired epic for this issue. Prefer the Jira Epic
      // Link; otherwise fall back to area-code routing; otherwise "Other".
      let targetEpicId: number | null = null;
      if (project) {
        const epicKey = epicFieldId ? readEpicKey(hit, epicFieldId) : null;
        if (epicKey) {
          const epicName = epicSummaries.get(epicKey) ?? epicKey;
          const existingEpic = epicsRepo.findByJiraEpicKey(project.id, epicKey);
          if (existingEpic) {
            if (existingEpic.name !== epicName) {
              epicsRepo.update(existingEpic.id, { name: epicName });
            }
            targetEpicId = existingEpic.id;
          } else {
            const epic = epicsRepo.create({
              projectId: project.id,
              name: epicName,
              jiraEpicKey: epicKey,
            });
            targetEpicId = epic.id;
          }
        } else {
          const fallbackName = detectAreaCode(hit.fields.summary, null) ?? 'Other';
          const existingEpics = epicsRepo.listForProject(project.id);
          const epic =
            existingEpics.find((e) => e.name === fallbackName) ??
            epicsRepo.create({ projectId: project.id, name: fallbackName });
          targetEpicId = epic.id;
        }
      }

      if (existing) {
        // Re-route the existing task to the (possibly different) target epic.
        // Routing is now stable (Jira Epic Link doesn't change frivolously),
        // so unconditional re-routing fixes tasks that landed under the wrong
        // area-code epic during an earlier sync.
        const update: Parameters<typeof tasksRepo.update>[1] = {
          title: hit.fields.summary,
          status: localStatus,
        };
        if (targetEpicId !== null && targetEpicId !== existing.epicId) {
          update.epicId = targetEpicId;
        }
        tasksRepo.update(existing.id, update);
        tasksRepo.updateJiraFields(existing.id, {
          jiraStatus: rawStatus,
          estimateSeconds: hit.fields.timeoriginalestimate ?? null,
          component: pickComponent(hit),
          syncedAt,
        });
        upserted += 1;
        continue;
      }

      if (!project || targetEpicId === null) {
        unrouted += 1;
        unroutedKeys.push(hit.key);
        continue;
      }

      const newTask = tasksRepo.create({
        epicId: targetEpicId,
        number: hit.key,
        title: hit.fields.summary,
        status: localStatus,
      });
      tasksRepo.updateJiraFields(newTask.id, {
        jiraStatus: rawStatus,
        estimateSeconds: hit.fields.timeoriginalestimate ?? null,
        component: pickComponent(hit),
        syncedAt,
      });
      created += 1;
      upserted += 1;
    }

    const removedFromBoard = tasksRepo.clearJiraStatusExcept(seenKeys);

    return {
      ok: true,
      startedAt,
      finishedAt: this.deps.now().toISOString(),
      fetched: issues.length,
      upserted,
      created,
      unrouted,
      unroutedKeys,
      removedFromBoard,
      neededBrowserRefresh: false,
    };
  }

  /**
   * Discover the custom-field id for "Epic Link" on this Jira instance.
   * Cached on disk at the same path the jira-fetch skill uses, so the
   * two tools share the lookup. Returns null on failure — caller falls
   * back to area-code routing.
   */
  private async discoverEpicFieldId(cookie: string): Promise<string | null> {
    if (this.epicLinkFieldIdOverride !== undefined) {
      return this.epicLinkFieldIdOverride;
    }
    const cached = readEpicFieldIdCache();
    if (cached) return cached;
    try {
      const res = await this.deps.fetch(`${this.cfg.baseUrl}/rest/api/2/field`, {
        method: 'GET',
        redirect: 'manual',
        headers: { Cookie: cookie, Accept: 'application/json' },
      });
      if (res.status < 200 || res.status >= 300) return null;
      const fields = (await res.json().catch(() => [])) as unknown;
      if (!Array.isArray(fields)) return null;
      const epicLink = (fields as Array<{ id: string; name: string }>).find(
        (f) => f && f.name === 'Epic Link',
      );
      if (!epicLink) return null;
      writeEpicFieldIdCache(epicLink.id);
      return epicLink.id;
    } catch {
      return null;
    }
  }

  /** Batch-fetch summaries for a set of epic keys. Best-effort. */
  private async fetchEpicSummaries(
    cookie: string,
    epicKeys: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (epicKeys.length === 0) return result;
    try {
      const res = await this.deps.fetch(`${this.cfg.baseUrl}/rest/api/2/search`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          jql: `key in (${epicKeys.join(',')})`,
          fields: ['summary'],
          maxResults: epicKeys.length,
        }),
      });
      if (res.status < 200 || res.status >= 300) return result;
      const data = (await res.json().catch(() => ({}))) as {
        issues?: Array<{ key: string; fields: { summary: string } }>;
      };
      for (const issue of data.issues ?? []) {
        if (issue.key && issue.fields?.summary) {
          result.set(issue.key, issue.fields.summary);
        }
      }
    } catch {
      /* best-effort — fall back to using epic keys as names */
    }
    return result;
  }
}

// ─── sync helpers ──────────────────────────────────────────────────────────

const JQL =
  'assignee = currentUser() AND resolution = Unresolved AND status != "Waiting" ' +
  'ORDER BY priority DESC, updated DESC';
const MAX_RESULTS = 200;

interface JiraIssueHit {
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    timeoriginalestimate: number | null;
    labels?: string[];
    components?: Array<{ name: string }>;
    // Epic Link sits at a per-instance customfield_NNNNN id, looked up
    // dynamically; we read it via readEpicKey() rather than declaring it
    // statically.
    [customField: string]: unknown;
  };
}

function pickComponent(hit: JiraIssueHit): string | null {
  const comp = hit.fields.components?.[0]?.name;
  if (comp) return comp;
  return hit.fields.labels?.[0] ?? null;
}

/**
 * Extract the Epic Link key (e.g. "TEH-456") from a Jira issue. The custom
 * field can hold either a bare key string or a full object — the v2 REST API
 * usually returns the key directly.
 */
function readEpicKey(hit: JiraIssueHit, fieldId: string): string | null {
  const raw = hit.fields[fieldId];
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (raw && typeof raw === 'object' && 'key' in raw) {
    const k = (raw as { key: unknown }).key;
    if (typeof k === 'string' && k.length > 0) return k;
  }
  return null;
}

/**
 * Read/write the shared on-disk cache used by both Watchtower's board sync
 * and the jira-fetch skill. The cache stores just the discovered Epic Link
 * customfield id (e.g. "customfield_10006").
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const EPIC_FIELD_CACHE = join(
  homedir(),
  '.claude/skills/jira-fetch/.cache/epic_field_id',
);

function readEpicFieldIdCache(): string | null {
  try {
    if (!existsSync(EPIC_FIELD_CACHE)) return null;
    const v = readFileSync(EPIC_FIELD_CACHE, 'utf8').trim();
    return v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeEpicFieldIdCache(id: string): void {
  try {
    mkdirSync(join(homedir(), '.claude/skills/jira-fetch/.cache'), { recursive: true });
    writeFileSync(EPIC_FIELD_CACHE, id, 'utf8');
  } catch {
    /* best-effort */
  }
}

function isAuthFailure(status: number): boolean {
  return status === 401 || status === 403 || status === 302 || status === 303;
}

function notConfiguredResult(startedAt: string, now: Date): BoardSyncResultPayload {
  return {
    ok: false,
    startedAt,
    finishedAt: now.toISOString(),
    fetched: 0,
    upserted: 0,
    created: 0,
    unrouted: 0,
    unroutedKeys: [],
    removedFromBoard: 0,
    neededBrowserRefresh: false,
    error: 'Jira board is not configured — set JIRA_BASE_URL and JIRA_KEYCHAIN_ACCOUNT.',
  };
}

function formatErrorChain(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  let depth = 0;
  while (current && depth < 5) {
    const e = current as { message?: string; code?: string; cause?: unknown };
    const piece = e.code ? `${e.message ?? '(no message)'} [${e.code}]` : e.message ?? String(current);
    parts.push(piece);
    if (!e.cause) break;
    current = e.cause;
    depth += 1;
  }
  return parts.join(' → ');
}

function earlyError(
  startedAt: string,
  now: Date,
  neededBrowserRefresh: boolean,
  error: string,
): BoardSyncResultPayload {
  return {
    ok: false,
    startedAt,
    finishedAt: now.toISOString(),
    fetched: 0,
    upserted: 0,
    created: 0,
    unrouted: 0,
    unroutedKeys: [],
    removedFromBoard: 0,
    neededBrowserRefresh,
    error,
  };
}
