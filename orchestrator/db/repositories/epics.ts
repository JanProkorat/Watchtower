import type { SqliteLike } from '../migrations.js';

export type EpicStatus = 'planned' | 'active' | 'done';

export interface EpicRow {
  id: number;
  projectId: number;
  name: string;
  description: string | null;
  status: EpicStatus;
  displayOrder: number;
  jiraEpicKey: string | null;
  /**
   * Substring used during board sync to route Jira tasks here. When the
   * linked Jira epic's name CONTAINS this string, the task is routed to
   * this local epic. NULL → this epic doesn't participate in shortcut
   * routing (it can still match by exact name as a fallback).
   */
  shortcut: string | null;
  githubIssueUrl: string | null;
  createdAt: string;
  /** Joined: total tasks under this epic. */
  taskCount: number;
  /** Joined: total minutes from worklogs on tasks under this epic. */
  totalMinutes: number;
}

export interface EpicWithProjectRow extends EpicRow {
  projectName: string;
  projectColor: string;
}

export interface EpicInput {
  projectId: number;
  name: string;
  description?: string | null;
  status?: EpicStatus;
  jiraEpicKey?: string | null;
  shortcut?: string | null;
  githubIssueUrl?: string | null;
}

type DbRow = {
  id: number;
  project_id: number;
  name: string;
  description: string | null;
  status: EpicStatus;
  display_order: number | null;
  jira_epic_key: string | null;
  shortcut: string | null;
  github_issue_url: string | null;
  created_at: string;
  task_count: number;
  total_minutes: number;
};

function toRow(r: DbRow): EpicRow {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    description: r.description,
    status: r.status,
    displayOrder: r.display_order ?? 0,
    jiraEpicKey: r.jira_epic_key,
    shortcut: r.shortcut,
    githubIssueUrl: r.github_issue_url,
    createdAt: r.created_at,
    taskCount: r.task_count,
    totalMinutes: r.total_minutes,
  };
}

function normaliseShortcut(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const LIST_SQL = `
  SELECT
    e.id, e.project_id, e.name, e.description, e.status, e.display_order,
    e.jira_epic_key, e.shortcut, e.github_issue_url, e.created_at,
    (SELECT COUNT(*) FROM tasks t WHERE t.epic_id = e.id) AS task_count,
    (SELECT COALESCE(SUM(w.minutes), 0)
       FROM worklogs w
       JOIN tasks t ON t.id = w.task_id
      WHERE t.epic_id = e.id) AS total_minutes
  FROM epics e
`;

export class EpicsRepo {
  constructor(private db: SqliteLike) {}

  listForProject(projectId: number): EpicRow[] {
    const rows = this.db
      .prepare(
        LIST_SQL +
          ` WHERE e.project_id = ?
           ORDER BY e.display_order ASC, e.id ASC`,
      )
      .all(projectId) as DbRow[];
    return rows.map(toRow);
  }

  /**
   * All epics across all non-archived projects, joined with project name +
   * color for the "create-task" fallback form in Settings (where the user
   * needs to pick an epic out of every project at once).
   */
  listAll(): EpicWithProjectRow[] {
    const rows = this.db
      .prepare(
        `
        SELECT
          e.id, e.project_id, e.name, e.description, e.status, e.display_order,
          e.jira_epic_key, e.shortcut, e.github_issue_url, e.created_at,
          (SELECT COUNT(*) FROM tasks t WHERE t.epic_id = e.id) AS task_count,
          0 AS total_minutes,
          p.name  AS project_name,
          p.color AS project_color
        FROM epics e
        JOIN projects p ON p.id = e.project_id
        WHERE p.archived = 0
        ORDER BY p.name COLLATE NOCASE ASC, e.display_order ASC, e.id ASC
        `,
      )
      .all() as Array<DbRow & { project_name: string; project_color: string }>;
    return rows.map((r) => ({
      ...toRow(r),
      projectName: r.project_name,
      projectColor: r.project_color,
    }));
  }

  get(id: number): EpicRow | null {
    const row = this.db.prepare(LIST_SQL + ' WHERE e.id = ?').get(id) as DbRow | undefined;
    return row ? toRow(row) : null;
  }

  /**
   * Find the epic (in a specific project) that mirrors a Jira Epic Link.
   * Used by the board sync to route an issue's task into the same epic
   * Jira has it under, instead of guessing from area-code prefixes.
   */
  findByJiraEpicKey(projectId: number, jiraEpicKey: string): EpicRow | null {
    const row = this.db
      .prepare(LIST_SQL + ' WHERE e.project_id = ? AND e.jira_epic_key = ? LIMIT 1')
      .get(projectId, jiraEpicKey) as DbRow | undefined;
    return row ? toRow(row) : null;
  }

  create(input: EpicInput): EpicRow {
    // Append at the end of the project's epic order. Steps of 1000 leave room
    // to splice between two rows later without renumbering.
    const maxRow = this.db
      .prepare(`SELECT COALESCE(MAX(display_order), 0) AS m FROM epics WHERE project_id = ?`)
      .get(input.projectId) as { m: number };
    const displayOrder = (maxRow.m ?? 0) + 1000;

    const info = this.db
      .prepare(
        `INSERT INTO epics
           (project_id, name, description, status, display_order, jira_epic_key, shortcut, github_issue_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.projectId,
        input.name,
        input.description ?? null,
        input.status ?? 'planned',
        displayOrder,
        input.jiraEpicKey ?? null,
        normaliseShortcut(input.shortcut),
        input.githubIssueUrl ?? null,
      ) as { lastInsertRowid: number | bigint };

    return this.get(Number(info.lastInsertRowid))!;
  }

  update(id: number, input: Partial<EpicInput>): EpicRow {
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, value: unknown) => {
      sets.push(`${col} = ?`);
      params.push(value);
    };
    if (input.name !== undefined) push('name', input.name);
    if (input.description !== undefined) push('description', input.description);
    if (input.status !== undefined) push('status', input.status);
    if (input.jiraEpicKey !== undefined) push('jira_epic_key', input.jiraEpicKey);
    if (input.shortcut !== undefined) push('shortcut', normaliseShortcut(input.shortcut));
    if (input.githubIssueUrl !== undefined) push('github_issue_url', input.githubIssueUrl);

    if (sets.length > 0) {
      params.push(id);
      this.db.prepare(`UPDATE epics SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }
    const row = this.get(id);
    if (!row) throw new Error(`epic ${id} not found after update`);
    return row;
  }

  /** Rewrites display_order for the given epic ids so the array order wins. */
  reorder(projectId: number, orderedIds: number[]): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const update = this.db.prepare(
        `UPDATE epics SET display_order = ? WHERE id = ? AND project_id = ?`,
      );
      orderedIds.forEach((id, i) => {
        update.run((i + 1) * 1000, id, projectId);
      });
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  delete(id: number): void {
    // tasks → worklogs cascade via ON DELETE CASCADE on the schema FK
    this.db.prepare(`DELETE FROM epics WHERE id = ?`).run(id);
  }
}
