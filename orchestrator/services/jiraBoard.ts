import type { SqliteLike } from '../db/migrations.js';
import {
  defaultDeps,
  loadJiraConfigFromEnv,
  type JiraConfig,
  type JiraSyncDeps,
} from './jiraSync.js';
import { ProjectsRepo, type ProjectRow } from '../db/repositories/projects.js';
import { EpicsRepo } from '../db/repositories/epics.js';
import { TasksRepo } from '../db/repositories/tasks.js';
import { detectAreaCode, extractEpicShortcut } from './jiraRouting.js';
import type {
  BoardAuthPingPayload,
  BoardCardPayload,
  BoardColumn,
  BoardSnapshotPayload,
  BoardSyncResultPayload,
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
 * Statuses we deliberately hide from the board even if Jira still surfaces
 * them on the underlying board. Kept separate from STATUS_TO_COLUMN so
 * legacy rows that synced before the board-API switch still get dropped.
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
// stable within-column order. Scoped to a single project.
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
  WHERE t.jira_status IS NOT NULL AND p.id = ?
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

/** Parsed board URL components. */
export interface ParsedBoardUrl {
  boardId: number;
  quickFilterId: number | null;
}

/**
 * Parse a Jira RapidBoard URL into a board id (`rapidView=...`) and an
 * optional quick filter id (`quickFilter=...`, first one wins if multiple
 * are present). Returns `null` for anything that isn't a recognisable URL
 * or doesn't carry a numeric `rapidView`.
 *
 * Exported for use by the sync code and for unit tests.
 */
export function parseJiraBoardUrl(raw: string | null | undefined): ParsedBoardUrl | null {
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  const rapid = parsed.searchParams.get('rapidView');
  if (!rapid) return null;
  const boardId = Number(rapid);
  if (!Number.isFinite(boardId) || boardId <= 0) return null;
  const qf = parsed.searchParams.get('quickFilter');
  const quickFilterId = qf != null ? Number(qf) : NaN;
  return {
    boardId,
    quickFilterId: Number.isFinite(quickFilterId) && quickFilterId > 0 ? quickFilterId : null,
  };
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

  getSnapshot(projectId: number): BoardSnapshotPayload {
    const rows = this.db.prepare(SNAPSHOT_SQL).all(projectId) as SnapshotRow[];
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

  async sync(projectId: number): Promise<BoardSyncResultPayload> {
    const startedAt = this.deps.now().toISOString();
    try {
      return await this.syncInner(projectId, startedAt);
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

  private async syncInner(
    projectId: number,
    startedAt: string,
  ): Promise<BoardSyncResultPayload> {
    if (!this.cfg.baseUrl || !this.cfg.keychainAccount) {
      return notConfiguredResult(startedAt, this.deps.now());
    }

    const projectsRepo = new ProjectsRepo(this.db);
    const project = projectsRepo.get(projectId);
    if (!project) {
      return earlyError(
        startedAt,
        this.deps.now(),
        false,
        `Project ${projectId} not found.`,
      );
    }
    const parsed = parseJiraBoardUrl(project.jiraBoardUrl);
    if (!parsed) {
      const msg = project.jiraBoardUrl
        ? 'Jira board URL on this project is invalid — expected a rapidView link from Jira.'
        : 'This project has no Jira board URL configured.';
      return earlyError(startedAt, this.deps.now(), false, msg);
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

    // Discover (and cache) the Epic Link customfield id so issues can be
    // slotted under the same epic Jira uses; fall back to area-code
    // routing when the call fails or the field doesn't exist.
    const epicFieldId = await this.discoverEpicFieldId(cookie);

    // If a quickFilter is set on the board URL, try to pull its JQL fragment
    // so we narrow the board exactly like the browser does. The quickfilter
    // route isn't reachable on every Jira Server deployment — when it isn't,
    // we fall back to the board's own filter (the issue endpoint already
    // narrows to board contents). Auth failures still abort hard; everything
    // else degrades to a warning on the sync result.
    let extraJql: string | null = null;
    let warning: string | null = null;
    if (parsed.quickFilterId !== null) {
      const qfResult = await this.fetchQuickFilterJql(
        cookie,
        parsed.boardId,
        parsed.quickFilterId,
      );
      if (qfResult.kind === 'auth') {
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
      if (qfResult.kind === 'error') {
        warning =
          `Couldn't apply quickFilter ${parsed.quickFilterId} — ${qfResult.message} ` +
          `Falling back to the board's base filter; results may be broader than what ` +
          `you see in Jira with the quickFilter active.`;
      } else {
        extraJql = qfResult.jql;
      }
    }

    const searchFields = ['summary', 'status', 'timeoriginalestimate', 'labels', 'components'];
    if (epicFieldId) searchFields.push(epicFieldId);

    // Paginate through the Agile board endpoint until isLast or the hard
    // ceiling kicks in. The board API returns issues exactly as the rapid
    // board renders them — same filter, same sprint, same quickFilter.
    const issues: JiraIssueHit[] = [];
    let startAt = 0;
    for (let page = 0; page < PAGE_CEILING; page += 1) {
      const url = new URL(
        `${this.cfg.baseUrl}/rest/agile/1.0/board/${parsed.boardId}/issue`,
      );
      url.searchParams.set('fields', searchFields.join(','));
      url.searchParams.set('maxResults', String(PAGE_SIZE));
      url.searchParams.set('startAt', String(startAt));
      const finalJql = extraJql ? `(${extraJql}) AND ${BASE_JQL}` : BASE_JQL;
      url.searchParams.set('jql', finalJql);

      const res = await this.deps.fetch(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        headers: {
          Cookie: cookie,
          Accept: 'application/json',
        },
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

      const data = (await res.json().catch(() => ({}))) as {
        issues?: JiraIssueHit[];
        isLast?: boolean;
        total?: number;
      };
      const pageIssues = data.issues ?? [];
      issues.push(...pageIssues);
      if (data.isLast || pageIssues.length < PAGE_SIZE) break;
      startAt += pageIssues.length;
    }

    const epicsRepo = new EpicsRepo(this.db);
    const tasksRepo = new TasksRepo(this.db);

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

      // Per-project board: every hit belongs to `project`. jiraGlobs are
      // bypassed — the URL already pinned the project.
      const existing = tasksRepo.findByNumber(hit.key);

      // Substring-based epic routing. When the task has a Jira Epic Link,
      // first try to find an existing local epic whose `shortcut` appears
      // anywhere in the linked Jira epic's name (e.g. shortcut="TEH"
      // matches Jira epic "TEH - Technologický postup"). Falls through to
      // an exact-name match against the extracted area code (this catches
      // the "Other" bucket and pre-shortcut epics seeded by past syncs).
      // If nothing matches, create a new local epic and auto-populate its
      // shortcut so future tasks converge to it.
      const epicKey = epicFieldId ? readEpicKey(hit, epicFieldId) : null;
      const epicSource = epicKey ? (epicSummaries.get(epicKey) ?? epicKey) : null;
      const existingEpics = epicsRepo.listForProject(project.id);

      let targetEpic = epicSource
        ? existingEpics.find(
            (e) =>
              e.shortcut !== null &&
              e.shortcut.length > 0 &&
              epicSource.includes(e.shortcut),
          )
        : undefined;

      if (!targetEpic) {
        const candidate =
          extractEpicShortcut(epicSource) ??
          detectAreaCode(hit.fields.summary, null) ??
          'Other';
        targetEpic =
          existingEpics.find((e) => e.name === candidate) ??
          epicsRepo.create({
            projectId: project.id,
            name: candidate,
            shortcut: candidate === 'Other' ? null : candidate,
          });
      }
      const targetEpicId = targetEpic.id;

      if (existing) {
        // Re-route the existing task to the (possibly different) target epic
        // and (when a different project owned it before — e.g. a key matching
        // an old glob) move it into THIS project. Routing is stable, so
        // unconditional re-routing fixes mis-routed legacy rows too.
        const update: Parameters<typeof tasksRepo.update>[1] = {
          title: hit.fields.summary,
          status: localStatus,
        };
        if (targetEpicId !== existing.epicId) {
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

    const removedFromBoard = tasksRepo.clearJiraStatusExceptForProject(
      project.id,
      seenKeys,
    );

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
      ...(warning ? { warning } : {}),
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

  /**
   * Resolve a quickFilter id → its JQL fragment by listing the board's
   * quickfilters and finding the one with matching id. We don't use the
   * per-id GET endpoint (`/board/{id}/quickfilter/{qfId}`) because some
   * Jira Server / Data Center versions return 404 for it even when the
   * filter exists on the LIST endpoint.
   *
   * `auth` signals that the cookie was rejected (caller surfaces a re-auth
   * prompt). `error` carries a non-auth failure message verbatim.
   */
  private async fetchQuickFilterJql(
    cookie: string,
    boardId: number,
    quickFilterId: number,
  ): Promise<
    | { kind: 'ok'; jql: string | null }
    | { kind: 'auth' }
    | { kind: 'error'; message: string }
  > {
    const url = `${this.cfg.baseUrl}/rest/agile/1.0/board/${boardId}/quickfilter`;
    let res: Response;
    try {
      res = await this.deps.fetch(url, {
        method: 'GET',
        redirect: 'manual',
        headers: { Cookie: cookie, Accept: 'application/json' },
      });
    } catch (err) {
      return { kind: 'error', message: `Quick filter list fetch failed: ${formatErrorChain(err)}` };
    }
    if (isAuthFailure(res.status) || res.status === 0) return { kind: 'auth' };
    if (res.status < 200 || res.status >= 300) {
      const text = await res.text().catch(() => '');
      return {
        kind: 'error',
        message: `Quick filter list HTTP ${res.status}: ${text.slice(0, 400) || 'no body'}`,
      };
    }
    const data = (await res.json().catch(() => null)) as unknown;
    const items = readQuickFilters(data);
    const found = items.find((qf) => Number(qf.id) === quickFilterId);
    if (!found) {
      const known = items.map((qf) => qf.id).join(', ') || '(none)';
      return {
        kind: 'error',
        message:
          `Quick filter ${quickFilterId} is not on board ${boardId}. ` +
          `Filters available on this board: ${known}. ` +
          `Remove or update the quickFilter parameter in the board URL.`,
      };
    }
    const jql = typeof found.jql === 'string' && found.jql.trim().length > 0
      ? found.jql.trim()
      : null;
    return { kind: 'ok', jql };
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

const PAGE_SIZE = 200;
/** Safety net so a buggy `isLast=false` from the server can't loop forever. */
const PAGE_CEILING = 10;
/**
 * Always-applied narrowing on top of the board's own saved filter. The Jira
 * cookie binds the request to a specific user, and `currentUser()` resolves
 * to that user server-side — so this works without us knowing or storing
 * the dzc/employee id in the client. `openSprints()` resolves to whatever
 * sprints are currently open on the issues' project(s); on a Kanban-only
 * board nothing matches and the sync returns empty (which is the right
 * signal — we don't support Kanban boards yet). Combined with any
 * quickFilter JQL via AND (with parens on the quickFilter side so its OR
 * clauses can't bleed past the AND).
 */
const BASE_JQL = 'sprint in openSprints() AND assignee = currentUser()';

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

interface RawQuickFilter {
  id: unknown;
  jql?: unknown;
}

/**
 * The Agile API LIST endpoint for quickfilters comes back in one of two
 * shapes depending on Jira version:
 *   - Newer (paginated): { values: [...] , isLast, startAt, maxResults }
 *   - Older / GreenHopper-style: a raw JSON array
 * Accept both. Anything that doesn't look like an object with an `id` is
 * dropped silently.
 */
function readQuickFilters(data: unknown): RawQuickFilter[] {
  const raw: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { values?: unknown }).values)
      ? (data as { values: unknown[] }).values
      : [];
  return raw.filter(
    (x): x is RawQuickFilter =>
      typeof x === 'object' && x !== null && 'id' in (x as Record<string, unknown>),
  );
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

// Re-export so the IPC handler can list projects-with-board without
// instantiating ProjectsRepo directly.
export function listProjectsWithBoard(db: SqliteLike): ProjectRow[] {
  return new ProjectsRepo(db)
    .list({ archived: false })
    .filter((p) => parseJiraBoardUrl(p.jiraBoardUrl) !== null);
}
