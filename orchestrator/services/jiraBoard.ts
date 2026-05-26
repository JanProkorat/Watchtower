import type { SqliteLike } from '../db/migrations.js';
import {
  defaultDeps,
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

/**
 * Watchtower-owned Keychain slot. NOT shared with jira-fetch (which uses
 * service=jira-skoda-cookie / account=dzc1cj8). The board's BrowserWindow
 * sign-in writes here; this service reads from here. First-ever load on a
 * clean machine therefore reports cookiePresent=false even if the user has
 * already authenticated to jira-fetch — which matches the user's mental
 * model that "I haven't signed in to the board yet."
 */
export function loadBoardJiraConfig(): JiraConfig {
  return {
    baseUrl: process.env.JIRA_BASE_URL || 'https://jira.skoda.vwgroup.com',
    keychainService: 'watchtower-jira-cookie',
    keychainAccount: 'default',
    // The board uses an Electron BrowserWindow for sign-in (electron/boardSignIn.ts),
    // not the Playwright shell-out the worklog sync uses, so this field is
    // unused on the board path. Kept for type compatibility with JiraConfig.
    refreshScript: '',
  };
}

/** Raw Jira status → merged Watchtower column. */
export const STATUS_TO_COLUMN: Record<string, BoardColumn> = {
  'To Do':       'todo',
  'In Progress': 'doing',
  'Waiting':     'doing',
  'In Review':   'doing',
  'In Test':     'done',
  'To Accept':   'done',
  'Done':        'done',
};

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
  project_id: number;
  project_name: string;
  project_color: string;
  epic_id: number;
  epic_name: string;
}

// node:sqlite doesn't support NULLS LAST — use the "(col IS NULL)" trick to
// push NULL estimates to the bottom, then estimate desc, then key asc for a
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
}

export class JiraBoardService {
  private readonly cfg: JiraConfig;
  private readonly deps: BoardSyncDeps;

  constructor(
    private readonly db: SqliteLike,
    opts: JiraBoardServiceOptions = {},
  ) {
    this.cfg = opts.config ?? loadBoardJiraConfig();
    this.deps = opts.deps ?? defaultDeps;
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
    const cards: BoardCardPayload[] = rows.map((r) => ({
      taskId: r.task_id,
      jiraKey: r.jira_key,
      title: r.title,
      jiraStatus: r.jira_status,
      // Default unknown statuses to 'doing' — they're in flight by definition.
      column: STATUS_TO_COLUMN[r.jira_status] ?? 'doing',
      estimateSeconds: r.jira_estimate_secs,
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

    const url = `${this.cfg.baseUrl}/rest/api/2/search`;
    const reqBody = JSON.stringify({
      jql: JQL,
      fields: SEARCH_FIELDS,
      maxResults: MAX_RESULTS,
    });
    const res = await this.deps.fetch(url, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: reqBody,
    });

    if (isAuthFailure(res.status)) {
      // Don't auto-refresh — surface the auth failure so the UI can flip to
      // "Sign in" mode. The user clicks once to refresh deliberately.
      return earlyError(
        startedAt,
        this.deps.now(),
        false,
        'Jira session expired. Sign in to Jira to refresh.',
      );
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
    // ProjectRow is structurally compatible with ProjectViewPayload (same field names).
    const allProjects = projectsRepo.list({}) as unknown as ProjectViewPayload[];

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

      const existing = tasksRepo.findByNumber(hit.key);
      if (existing) {
        tasksRepo.update(existing.id, {
          title: hit.fields.summary,
          status: localStatus,
        });
        tasksRepo.updateJiraFields(existing.id, {
          jiraStatus: rawStatus,
          estimateSeconds: hit.fields.timeoriginalestimate ?? null,
          component: pickComponent(hit),
          syncedAt,
        });
        upserted += 1;
        continue;
      }

      const project = pickProjectForKey(hit.key, allProjects);
      if (!project) {
        unrouted += 1;
        unroutedKeys.push(hit.key);
        continue;
      }
      const areaCode = detectAreaCode(hit.fields.summary, null);
      const epicName = areaCode ?? 'Other';
      const existingEpics = epicsRepo.listForProject(project.id);
      const epic =
        existingEpics.find((e) => e.name === epicName) ??
        epicsRepo.create({ projectId: project.id, name: epicName });

      const newTask = tasksRepo.create({
        epicId: epic.id,
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
}

// ─── sync helpers ──────────────────────────────────────────────────────────

const JQL = 'assignee = currentUser() AND resolution = Unresolved ORDER BY priority DESC, updated DESC';
const SEARCH_FIELDS = ['summary', 'status', 'timeoriginalestimate', 'labels', 'components'];
const MAX_RESULTS = 200;

interface JiraIssueHit {
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    timeoriginalestimate: number | null;
    labels?: string[];
    components?: Array<{ name: string }>;
  };
}

function pickComponent(hit: JiraIssueHit): string | null {
  const comp = hit.fields.components?.[0]?.name;
  if (comp) return comp;
  return hit.fields.labels?.[0] ?? null;
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
