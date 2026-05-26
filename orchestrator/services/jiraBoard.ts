import type { SqliteLike } from '../db/migrations.js';
import {
  defaultDeps,
  loadJiraConfigFromEnv,
  type JiraConfig,
  type JiraSyncDeps,
} from './jiraSync.js';
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
    this.cfg = opts.config ?? loadJiraConfigFromEnv();
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
    throw new Error('JiraBoardService.sync not implemented');
  }
}
